import hashlib
import io
import json
import math
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit

import requests
from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from xml.sax.saxutils import escape

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

app = Flask(__name__)
CORS(
    app,
    resources={
        r'/api/*': {
            'origins': [
                'http://localhost:5173',
                'http://localhost:5174',
                'http://localhost:5175',
                'http://127.0.0.1:5173',
                'http://127.0.0.1:5174',
                'http://127.0.0.1:5175',
            ],
            'methods': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            'allow_headers': ['Content-Type', 'Authorization'],
        }
    },
)

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(exist_ok=True)
DATA_FILE = DATA_DIR / 'app_data.json'
UPLOAD_DIR = Path(os.getenv('UPLOAD_FOLDER', str(BASE_DIR / 'uploads')))
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = PROJECT_DIR / UPLOAD_DIR
UPLOAD_DIR = UPLOAD_DIR.resolve()
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_UPLOAD_SIZE_BYTES = 16 * 1024 * 1024
FOOD_IMAGE_CACHE = {}
FOOD_IMAGE_CACHE_LOCK = threading.Lock()
FOOD_IMAGE_CACHE_TTL_SECONDS = 3600
DATA_SAVE_LOCK = threading.Lock()
DELIVERY_FEEDBACK_LOCK = threading.Lock()
DELIVERY_ISSUE_LOCK = threading.Lock()
DONATION_CANCELLATION_LOCK = threading.Lock()
REQUEST_CONTRIBUTION_LOCK = threading.Lock()
ROLE_VALUES = {'donor', 'requester', 'volunteer', 'ngo', 'admin'}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def validate_food_expiry(preparation_time, food_expiry):
    try:
        prepared = datetime.fromisoformat(str(preparation_time).replace('Z', '+00:00'))
        expires = datetime.fromisoformat(str(food_expiry).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return 'Preparation time and Food Expiry Date & Time must be valid date and time values.'
    if prepared.tzinfo is None:
        prepared = prepared.replace(tzinfo=timezone.utc)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= prepared:
        return 'Food Expiry Date & Time must be later than the preparation time.'
    return ''


def validate_pickup_deadline(preparation_time, food_expiry, pickup_deadline):
    if not pickup_deadline:
        return ''
    try:
        prepared = datetime.fromisoformat(str(preparation_time).replace('Z', '+00:00'))
        expires = datetime.fromisoformat(str(food_expiry).replace('Z', '+00:00'))
        pickup = datetime.fromisoformat(str(pickup_deadline).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return 'Pickup Available Until must be a valid date and time.'
    if prepared.tzinfo is None:
        prepared = prepared.replace(tzinfo=timezone.utc)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if pickup.tzinfo is None:
        pickup = pickup.replace(tzinfo=timezone.utc)
    if pickup <= prepared:
        return 'Pickup Available Until must be after the preparation time.'
    if pickup > expires:
        return 'Pickup Available Until cannot be later than the Food Expiry Date & Time.'
    return ''


def validate_request_priority_schedule(priority, required_date, required_time):
    if priority is not None and str(priority).strip().casefold() not in {'high', 'medium', 'low'}:
        return 'Request Priority must be High, Medium, or Low.'
    if bool(required_date) != bool(required_time):
        return 'Both Required Date and Required Time must be provided.'
    if not required_date:
        return ''
    try:
        required_at = datetime.fromisoformat(f'{required_date}T{required_time}')
    except (TypeError, ValueError):
        return 'Required Date and Required Time must be valid.'
    current_local = datetime.now().astimezone().replace(tzinfo=None)
    if required_at.tzinfo is not None:
        required_at = required_at.astimezone().replace(tzinfo=None)
    if required_at <= current_local:
        return 'Required Date and Required Time must be in the future.'
    return ''


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


def set_donation_status(data, donation, status, changed_by, note):
    previous_status = donation.get('status')
    if previous_status == status:
        return
    donation['status'] = status
    donation['updated_at'] = utc_now()
    data.setdefault('donation_status_history', []).append({
        'id': f'history-{uuid.uuid4().hex}',
        'donation_id': donation['id'],
        'previous_status': previous_status,
        'new_status': status,
        'changed_by': changed_by,
        'note': note,
        'created_at': utc_now(),
    })


def donation_available_quantity(data, donation):
    donation_id = donation.get('id')
    requested_quantity = sum(
        float(item.get('requested_quantity', 0) or 0)
        for item in data.get('donation_requests', [])
        if item.get('donation_id') == donation_id
        and item.get('status') not in {'cancelled', 'rejected'}
    )
    contributed_quantity = sum(
        float(item.get('quantity', 0) or 0)
        for item in data.get('request_contributions', [])
        if item.get('donation_id') == donation_id
        and item.get('status') not in {'cancelled', 'rejected'}
    )
    unallocated_quantity = max(
        0,
        float(donation.get('quantity', 0) or 0) - requested_quantity - contributed_quantity,
    )
    return min(unallocated_quantity, donation_remaining_quantity(data, donation))


def donation_distributed_quantity(data, donation):
    donation_id = donation.get('id')
    delivered_tasks = [
        task for task in data.get('delivery_tasks', [])
        if task.get('status') == 'delivered'
        and delivery_task_donation_id(data, task) == donation_id
    ]
    contributions_by_id = {
        item.get('id'): item for item in data.get('request_contributions', [])
    }
    requests_by_id = {
        item.get('id'): item for item in data.get('donation_requests', [])
    }
    distributed = 0
    for task in delivered_tasks:
        task_quantity = task.get('quantity')
        if task_quantity is None:
            contribution = contributions_by_id.get(task.get('request_contribution_id'))
            request_item = requests_by_id.get(task.get('request_id'))
            task_quantity = (
                contribution.get('quantity', 0)
                if contribution
                else request_item.get('requested_quantity', 0) if request_item else 0
            )
        distributed += float(task_quantity or 0)
    delivered_task_ids = {task.get('id') for task in delivered_tasks}
    delivered_contribution_ids = {
        task.get('request_contribution_id')
        for task in delivered_tasks
        if task.get('request_contribution_id')
    }
    distributed += sum(
        float(contribution.get('quantity', 0) or 0)
        for contribution in data.get('request_contributions', [])
        if contribution.get('donation_id') == donation_id
        and contribution.get('status') == 'delivered'
        and contribution.get('delivery_task_id') not in delivered_task_ids
        and contribution.get('id') not in delivered_contribution_ids
    )

    task_request_ids = {task.get('request_id') for task in delivered_tasks}
    for request_item in data.get('donation_requests', []):
        if (
            request_item.get('donation_id') == donation_id
            and not request_item.get('multi_contribution')
            and request_item.get('status') in {'completed', 'fulfilled'}
            and request_item.get('id') not in task_request_ids
            and not any(
                task.get('request_id') == request_item.get('id')
                for task in data.get('delivery_tasks', [])
            )
        ):
            distributed += float(request_item.get('requested_quantity', 0) or 0)
    return min(float(donation.get('quantity', 0) or 0), distributed)


def donation_remaining_quantity(data, donation):
    return max(
        0,
        float(donation.get('quantity', 0) or 0) - donation_distributed_quantity(data, donation),
    )


def donation_expiry_datetime(donation):
    return donation_datetime(donation.get('available_until'))


def donation_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def donation_is_within_validity_period(donation, now=None):
    start = donation_datetime(donation.get('preparation_time'))
    end = donation_expiry_datetime(donation)
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    return start is not None and end is not None and start <= current_time < end


def donation_is_expired(donation, now=None):
    expiry = donation_expiry_datetime(donation)
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    return expiry is not None and expiry <= current_time


def expire_donation_if_due(data, donation, now=None):
    if donation.get('status') in {'completed', 'cancelled', 'rejected', 'expired'}:
        return False
    if donation_remaining_quantity(data, donation) <= 0:
        set_donation_status(
            data,
            donation,
            'completed',
            'system',
            'Donation quantity fully distributed',
        )
        return True
    if not donation_is_expired(donation, now):
        return False
    set_donation_status(
        data,
        donation,
        'expired',
        'system',
        'Food validity period expired',
    )
    return True


def expire_due_donations(data):
    changed = False
    for donation in data.get('donations', []):
        changed = expire_donation_if_due(data, donation) or changed
    return changed


def donation_is_requestable(data, donation, now=None):
    return (
        donation.get('status') in {'available', 'requested', 'accepted'}
        and donation_is_within_validity_period(donation, now)
        and donation_available_quantity(data, donation) > 0
    )


def donation_can_continue_distribution(data, donation, now=None):
    return (
        donation.get('status') not in {'completed', 'cancelled', 'rejected', 'expired'}
        and donation_is_within_validity_period(donation, now)
        and donation_remaining_quantity(data, donation) > 0
    )


def serialize_public_donation(data, donation):
    status_history = sorted(
        (
            {
                'status': item.get('new_status', ''),
                'created_at': item.get('created_at', ''),
            }
            for item in data.get('donation_status_history', [])
            if item.get('donation_id') == donation.get('id')
            and item.get('new_status')
        ),
        key=lambda item: item.get('created_at') or '',
    )
    return {
        'id': donation.get('id'),
        'food_name': donation.get('food_name', ''),
        'category': donation.get('category', ''),
        'description': donation.get('description', ''),
        'quantity': donation.get('quantity', 0),
        'available_quantity': donation_available_quantity(data, donation),
        'distributed_quantity': donation_distributed_quantity(data, donation),
        'remaining_quantity': donation_remaining_quantity(data, donation),
        'quantity_unit': donation.get('quantity_unit', ''),
        'servings': donation.get('servings', 0),
        'is_veg': donation.get('is_veg', True),
        'image_url': donation.get('image_url', ''),
        'image_source': donation.get('image_source', ''),
        'city': donation.get('city', ''),
        'status': donation.get('status', ''),
        'is_requestable': donation_is_requestable(data, donation),
        'preparation_time': donation.get('preparation_time', ''),
        'available_until': donation.get('available_until', ''),
        'pickup_available_until': donation.get('pickup_available_until', ''),
        'created_at': donation.get('created_at', ''),
        'status_history': status_history,
    }


def public_donation_is_available(data, donation):
    return donation_is_requestable(data, donation)


def donation_matches_food_request(donation, request_item):
    if str(donation.get('quantity_unit') or '').strip().casefold() != str(request_item.get('quantity_unit') or '').strip().casefold():
        return False
    request_category = str(request_item.get('category') or '').strip().casefold()
    donation_category = str(donation.get('category') or '').strip().casefold()
    request_food = str(request_item.get('food_name') or '').strip().casefold()
    donation_food = str(donation.get('food_name') or '').strip().casefold()
    return bool(
        (request_category and request_category == donation_category)
        or (request_food and request_food in {donation_food, donation_category})
    )


def sync_donation_request_status(data, donation, changed_by, note):
    if donation.get('status') in {'expired', 'completed', 'cancelled', 'rejected'}:
        return
    related_statuses = {
        item.get('status')
        for item in data.get('donation_requests', [])
        if item.get('donation_id') == donation.get('id')
    }
    next_status = (
        'accepted' if related_statuses.intersection({'approved', 'accepted'})
        else 'requested' if 'pending' in related_statuses
        else 'available'
    )
    set_donation_status(data, donation, next_status, changed_by, note)


def set_request_status(request_item, status, changed_by):
    previous_status = request_item.get('status')
    history = request_item.setdefault('status_history', [])
    if not history and previous_status:
        history.append({
            'status': previous_status,
            'changed_by': None,
            'created_at': request_item.get('created_at', utc_now()),
        })
    updated_at = utc_now()
    request_item['status'] = status
    request_item['updated_at'] = updated_at
    if previous_status != status:
        history.append({
            'status': status,
            'changed_by': changed_by,
            'created_at': updated_at,
        })


def donation_cancellation_allowed(data, donation):
    if donation.get('status') not in {'available', 'requested', 'accepted'}:
        return False
    return not any(
        task.get('donation_id') == donation.get('id')
        and task.get('status') in {'picked_up', 'in_transit', 'delivered'}
        for task in data.get('delivery_tasks', [])
    )


def notify_user(data, user_id, message, notification_type='delivery', link='/dashboard'):
    if not user_id:
        return
    data.setdefault('notifications', []).append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': user_id,
        'message': message,
        'type': notification_type,
        'link': link,
        'read_at': None,
        'created_at': utc_now(),
    })


def delivery_task_donation_id(data, task):
    if task.get('donation_id'):
        return task['donation_id']

    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
        None,
    )
    if request_item and request_item.get('donation_id'):
        return request_item['donation_id']

    contribution = next(
        (
            item for item in data.get('request_contributions', [])
            if item.get('id') == task.get('request_contribution_id')
        ),
        None,
    )
    return contribution.get('donation_id') if contribution else None


def delivery_issue_context(data, issue):
    task_id = issue.get('task_id') or issue.get('delivery_id')
    task = next(
        (item for item in data.get('delivery_tasks', []) if item.get('id') == task_id),
        None,
    )
    request_id = issue.get('request_id') or (task.get('request_id') if task else None)
    if not request_id and task and task.get('request_contribution_id'):
        contribution = next(
            (
                item for item in data.get('request_contributions', [])
                if item.get('id') == task.get('request_contribution_id')
            ),
            None,
        )
        request_id = contribution.get('request_id') if contribution else None
    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == request_id),
        None,
    )
    donation_id = issue.get('donation_id')
    if not donation_id and task:
        donation_id = delivery_task_donation_id(data, task)
    donation = next(
        (item for item in data.get('donations', []) if item.get('id') == donation_id),
        None,
    )
    return task, request_item, donation


def delivery_issue_visible_to_user(user, issue, task, request_item, donation):
    role = user.get('role')
    user_id = user.get('id')
    if role == 'admin':
        return True
    if role == 'requester':
        reporter_id = issue.get('reporter_id') or issue.get('receiver_id')
        request_reporter_id = (
            request_item.get('requester_id', request_item.get('ngo_id'))
            if request_item else None
        )
        return user_id in {reporter_id, request_reporter_id}
    if role == 'ngo':
        return bool(task and task.get('ngo_id') == user_id)
    if role == 'donor':
        return bool(donation and donation.get('donor_id') == user_id)
    if role == 'volunteer':
        return bool(task and task.get('volunteer_id') == user_id)
    return False


def serialize_delivery_issue(data, issue):
    serialized = dict(issue)
    task, request_item, donation = delivery_issue_context(data, issue)
    serialized.setdefault('task_id', task.get('id') if task else issue.get('delivery_id'))
    serialized.setdefault('delivery_id', serialized.get('task_id'))
    serialized.setdefault('request_id', request_item.get('id') if request_item else None)
    serialized.setdefault(
        'donation_id',
        donation.get('id') if donation else None,
    )
    serialized.setdefault(
        'reporter_id',
        issue.get('receiver_id') or (
            request_item.get('requester_id', request_item.get('ngo_id'))
            if request_item else None
        ),
    )
    serialized.setdefault('category', 'delivery')
    serialized.setdefault('resolution_note', '')
    serialized.setdefault('status_history', [])
    return serialized


def request_delivered_quantity(data, request_item):
    requested_quantity = float(request_item.get('requested_quantity', 0) or 0)
    if request_item.get('multi_contribution'):
        return sum(
            float(item.get('quantity', 0) or 0)
            for item in data.get('request_contributions', [])
            if item.get('request_id') == request_item.get('id')
            and item.get('status') == 'delivered'
        )

    delivered_tasks = [
        task for task in data.get('delivery_tasks', [])
        if task.get('request_id') == request_item.get('id')
        and task.get('status') == 'delivered'
    ]
    if delivered_tasks:
        return sum(
            float(task.get('quantity', requested_quantity) or 0)
            for task in delivered_tasks
        )
    if request_item.get('status') in {'completed', 'fulfilled'}:
        return requested_quantity
    return 0


def request_has_pending_delivery(data, request_item):
    if request_item.get('status') in {'approved', 'accepted'}:
        return True
    active_contributions = {
        item.get('id') for item in data.get('request_contributions', [])
        if item.get('request_id') == request_item.get('id')
        and item.get('status') not in {'delivered', 'cancelled', 'rejected'}
    }
    if active_contributions:
        return True
    return any(
        task.get('request_id') == request_item.get('id')
        and task.get('status') not in {'delivered', 'cancelled', 'rejected'}
        or task.get('request_contribution_id') in active_contributions
        for task in data.get('delivery_tasks', [])
    )


def request_has_available_food(data, request_item):
    return any(
        donation_is_requestable(data, donation)
        and donation_matches_food_request(donation, request_item)
        and (
            donation_available_quantity(data, donation) > 0
            or (
                donation.get('id') == request_item.get('donation_id')
                and not request_item.get('multi_contribution')
            )
        )
        for donation in data.get('donations', [])
    )


def update_multi_contribution_request_status(data, request_item, changed_by):
    if not request_item.get('multi_contribution'):
        return
    requested_quantity = float(request_item.get('requested_quantity', 0) or 0)
    delivered_quantity = request_delivered_quantity(data, request_item)
    if request_item.get('status') in {'cancelled', 'rejected'}:
        return
    next_status = (
        'fulfilled'
        if requested_quantity > 0 and delivered_quantity >= requested_quantity
        else 'partially_fulfilled' if delivered_quantity > 0 else request_item.get('status', 'pending')
    )
    if request_item.get('status') != next_status:
        set_request_status(request_item, next_status, changed_by)


DONATION_MILESTONES = {
    1: {
        'key': 'first_donation',
        'title': 'First Donation Certificate',
        'name': 'First Donation',
        'message': 'Your first completed food donation helped reduce waste and bring nourishment to someone in need.',
    },
    5: {
        'key': 'community_hero',
        'title': 'Community Hero Certificate',
        'name': 'Community Hero',
        'message': 'Five completed food donations show a generous commitment to nourishing and supporting your community.',
    },
    15: {
        'key': 'food_donation_champion_15',
        'title': 'Food Donation Champion Certificate',
        'name': 'Food Donation Champion',
        'message': 'Fifteen completed food donations make you a champion of food redistribution and community care.',
    },
    25: {
        'key': 'humanity_ambassador',
        'title': 'Humanity Ambassador Certificate',
        'name': 'Humanity Ambassador',
        'message': 'Twenty-five completed food donations are a lasting contribution to dignity, nourishment, and hope.',
    },
}


def donor_completed_donations(data, donor_id):
    if not donor_id:
        return []

    donor_donations = [
        item
        for item in data.get('donations', [])
        if item.get('donor_id') == donor_id
    ]
    donations_by_id = {item.get('id'): item for item in donor_donations}

    def delivery_date(task):
        return next(
            (
                item.get('created_at')
                for item in task.get('status_history', [])
                if item.get('status') == 'delivered'
            ),
            task.get('delivered_at') or task.get('updated_at') or task.get('created_at') or '',
        )

    def delivery_date_key(value):
        try:
            parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        except (TypeError, ValueError):
            return float('-inf')
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()

    delivered_tasks_by_donation = {}
    for task in data.get('delivery_tasks', []):
        donation_id = delivery_task_donation_id(data, task)
        if task.get('status') == 'delivered' and donation_id in donations_by_id:
            delivered_tasks_by_donation.setdefault(donation_id, []).append(task)

    completed_donations = [
        donation
        for donation in donor_donations
        if donation.get('status') == 'completed'
        or donation.get('id') in delivered_tasks_by_donation
    ]

    completed = []
    for donation in completed_donations:
        donation_id = donation.get('id')
        tasks = delivered_tasks_by_donation.get(donation_id, [])
        completed.append({
            'donation': donation,
            'delivery_date': max(
                (delivery_date(task) for task in tasks),
                key=delivery_date_key,
            ) if tasks else donation.get('updated_at') or donation.get('created_at') or '',
        })
    completed.sort(key=lambda item: (delivery_date_key(item['delivery_date']), item['donation'].get('id') or ''))
    return completed


def create_donor_certificates(data, donor_id):
    completed_donations = donor_completed_donations(data, donor_id)
    donation_certificates = []
    milestone_certificates = []
    certificates_changed = False
    certificates = data.setdefault('donation_certificates', [])
    donor = find_profile_by_id(data, donor_id) or {}

    for completed_count, completed_item in enumerate(completed_donations, start=1):
        donation = completed_item['donation']
        existing_certificate = next(
            (
                item for item in certificates
                if item.get('donor_id') == donor_id
                and item.get('donation_id') == donation.get('id')
                and (item.get('certificate_type') == 'donation' or not item.get('milestone'))
            ),
            None,
        )
        if existing_certificate:
            if 'completed_donations' not in existing_certificate:
                existing_certificate['completed_donations'] = completed_count
                certificates_changed = True
            continue
        certificate = {
            'id': f'certificate-{uuid.uuid4().hex}',
            'certificate_id': f'SFDRS-DON-{uuid.uuid4().hex.upper()}',
            'certificate_type': 'donation',
            'donor_id': donor_id,
            'donor_name': donor.get('full_name', ''),
            'donation_id': donation.get('id'),
            'food_name': donation.get('food_name', ''),
            'category': donation.get('category', ''),
            'quantity': donation.get('quantity', 0),
            'quantity_unit': donation.get('quantity_unit', ''),
            'completed_donations': completed_count,
            'donation_date': donation.get('created_at', ''),
            'delivery_date': completed_item['delivery_date'],
            'title': 'Certificate of Food Donation',
            'message': 'Your generous food donation helped reduce food waste and bring nourishment to people in need.',
            'created_at': utc_now(),
        }
        certificates.append(certificate)
        donation_certificates.append(certificate)
        certificates_changed = True

    for target, milestone in DONATION_MILESTONES.items():
        if len(completed_donations) < target:
            continue
        completed_item = completed_donations[target - 1]
        certificate = next(
            (
                item for item in certificates
                if item.get('donor_id') == donor_id
                and item.get('certificate_type') == 'milestone'
                and int(item.get('completed_donations', item.get('completed_deliveries', 0)) or 0) == target
            ),
            None,
        )
        if certificate:
            updates = {
                'milestone': milestone['key'],
                'milestone_name': milestone['name'],
                'title': milestone['title'],
                'completed_donations': target,
                'completed_deliveries': target,
                'message': milestone['message'],
            }
            if any(certificate.get(key) != value for key, value in updates.items()):
                certificate.update(updates)
                certificates_changed = True
        else:
            certificate = {
                'id': f'certificate-{uuid.uuid4().hex}',
                'certificate_id': f'SFDRS-DON-M{target:02d}-{uuid.uuid4().hex.upper()}',
                'certificate_type': 'milestone',
                'donor_id': donor_id,
                'donor_name': donor.get('full_name', ''),
                'milestone': milestone['key'],
                'milestone_name': milestone['name'],
                'title': milestone['title'],
                'completed_donations': target,
                'completed_deliveries': target,
                'achievement_date': completed_item['delivery_date'],
                'message': milestone['message'],
                'created_at': utc_now(),
                'donation_id': completed_item['donation'].get('id'),
                'celebration_pending': False,
            }
            certificates.append(certificate)
            milestone_certificates.append(certificate)
            certificates_changed = True
    return {
        'donation_certificates': donation_certificates,
        'milestone_certificates': milestone_certificates,
        'changed': certificates_changed,
    }


def serialize_request_contribution_updates(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        with REQUEST_CONTRIBUTION_LOCK:
            return view(*args, **kwargs)
    return wrapped


def seed_data():
    initial_data = {
        'profiles': [],
        'sessions': [],
        'donations': [],
        'donation_requests': [],
        'donation_status_history': [],
        'community_needs': [],
        'community_need_contributions': [],
        'notifications': [],
        'distribution_records': [],
        'donation_certificates': [],
        'donor_rewards': [],
        'impact_stories': [],
        'complaints': [],
        'audit_logs': [],
        'donation_submission_keys': {},
        'delivery_tasks': [],
        'request_contributions': [],
        'volunteer_availability': [],
        'delivery_feedback': [],
        'delivery_issues': [],
        'donation_cancellations': [],
    }
    temp_file = DATA_FILE.with_name(f'{DATA_FILE.name}.{uuid.uuid4().hex}.tmp')
    try:
        with temp_file.open('w', encoding='utf-8') as seed_file:
            json.dump(initial_data, seed_file, indent=2)
            seed_file.flush()
            os.fsync(seed_file.fileno())
        try:
            os.link(temp_file, DATA_FILE)
        except FileExistsError:
            pass
    finally:
        temp_file.unlink(missing_ok=True)


def task_deadline_datetime(value, date_only_is_end_of_day=False):
    if not value:
        return None
    try:
        value_string = str(value).strip()
        if date_only_is_end_of_day and len(value_string) == 10:
            parsed = datetime.combine(
                datetime.fromisoformat(value_string).date(),
                datetime.max.time(),
            )
        else:
            parsed = datetime.fromisoformat(value_string.replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone() if parsed.tzinfo is None else parsed


def delivery_task_deadline(data, task):
    deadlines = [
        task_deadline_datetime(task.get(field), date_only_is_end_of_day=True)
        for field in ('deadline', 'scheduled_at', 'available_until', 'pickup_available_until')
    ]
    for date_field, time_field in (
        ('scheduled_date', 'scheduled_time'),
        ('required_date', 'required_time'),
        ('due_date', 'due_time'),
    ):
        date_value = task.get(date_field)
        time_value = task.get(time_field)
        if date_value:
            scheduled_value = f'{date_value}T{time_value}' if time_value else date_value
            deadlines.append(
                task_deadline_datetime(scheduled_value, date_only_is_end_of_day=True)
            )

    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
        None,
    )
    request_contribution = next(
        (
            item for item in data.get('request_contributions', [])
            if item.get('id') == task.get('request_contribution_id')
        ),
        None,
    )
    if not request_item and request_contribution:
        request_item = next(
            (
                item for item in data.get('donation_requests', [])
                if item.get('id') == request_contribution.get('request_id')
            ),
            None,
        )
    if request_item:
        required_date = request_item.get('required_date')
        required_time = request_item.get('required_time')
        scheduled_value = (
            f'{required_date}T{required_time}'
            if required_date and required_time
            else required_date
        )
        deadlines.append(task_deadline_datetime(scheduled_value, date_only_is_end_of_day=True))

    donation_id = delivery_task_donation_id(data, task)
    if not donation_id and request_contribution:
        donation_id = request_contribution.get('donation_id')
    donation = next(
        (item for item in data.get('donations', []) if item.get('id') == donation_id),
        None,
    )
    if donation:
        deadlines.extend(
            task_deadline_datetime(donation.get(field))
            for field in ('available_until', 'pickup_available_until')
        )

    community_contribution = next(
        (
            item for item in data.get('community_need_contributions', [])
            if item.get('id') == task.get('community_contribution_id')
        ),
        None,
    )
    need_id = task.get('community_need_id') or (
        community_contribution.get('need_id') if community_contribution else None
    )
    need = next(
        (item for item in data.get('community_needs', []) if item.get('id') == need_id),
        None,
    )
    if need:
        deadlines.append(
            task_deadline_datetime(need.get('required_date'), date_only_is_end_of_day=True)
        )

    valid_deadlines = [deadline for deadline in deadlines if deadline is not None]
    return min(valid_deadlines) if valid_deadlines else None


def remove_expired_incomplete_delivery_tasks(data, now=None):
    current_time = now or datetime.now().astimezone()
    if current_time.tzinfo is None:
        current_time = current_time.astimezone()
    kept_tasks = []
    removed_ids = []
    for task in data.get('delivery_tasks', []):
        if task.get('status') in {'completed', 'delivered'}:
            kept_tasks.append(task)
            continue
        deadline = delivery_task_deadline(data, task)
        if deadline is not None and deadline <= current_time:
            removed_ids.append(task.get('id', '<missing id>'))
        else:
            kept_tasks.append(task)
    if removed_ids:
        data['delivery_tasks'] = kept_tasks
        app.logger.info(
            'Removed incomplete delivery tasks past their linked deadline: %s',
            ', '.join(removed_ids),
        )
    return bool(removed_ids)


def load_data():
    if not DATA_FILE.exists():
        seed_data()
    with DATA_SAVE_LOCK:
        data = json.loads(DATA_FILE.read_text(encoding='utf-8'))
    donations = data.get('donations', [])
    unique_donations = {}
    duplicate_ids = set()
    for donation in donations:
        donation_id = donation.get('id')
        if not donation_id or donation_id not in unique_donations:
            unique_donations[donation_id or f'__missing_id_{len(unique_donations)}'] = donation
            continue

        duplicate_ids.add(donation_id)
        existing = unique_donations[donation_id]
        if donation.get('updated_at', '') > existing.get('updated_at', ''):
            newer, older = donation, existing
            unique_donations[donation_id] = newer
        else:
            newer, older = existing, donation
        for key, value in older.items():
            if newer.get(key) in (None, '') and value not in (None, ''):
                newer[key] = value

    data_changed = False
    if duplicate_ids:
        app.logger.warning(
            'Removed duplicate donation rows for existing IDs: %s',
            ', '.join(sorted(duplicate_ids)),
        )
        data['donations'] = list(unique_donations.values())
        data_changed = True
    if remove_expired_incomplete_delivery_tasks(data):
        data_changed = True
    if data_changed:
        save_data(data)
    return data


def save_data(data):
    temp_file = DATA_FILE.with_name(f'{DATA_FILE.name}.{uuid.uuid4().hex}.tmp')
    with DATA_SAVE_LOCK:
        try:
            if DATA_FILE.exists():
                try:
                    current_data = json.loads(DATA_FILE.read_text(encoding='utf-8'))
                except (OSError, json.JSONDecodeError) as error:
                    raise OSError(f'Could not read current application data from {DATA_FILE}.') from error
                current_profiles = current_data.get('profiles', [])
                profiles_by_id = {
                    profile.get('id'): profile
                    for profile in current_profiles
                    if isinstance(profile, dict) and profile.get('id')
                }
                profiles_by_id.update({
                    profile.get('id'): profile
                    for profile in data.get('profiles', [])
                    if isinstance(profile, dict) and profile.get('id')
                })
                data['profiles'] = list(profiles_by_id.values())

            write_data_file_atomically(data, temp_file)
        finally:
            temp_file.unlink(missing_ok=True)


def write_data_file_atomically(data, temp_file=None):
    if temp_file is None:
        temp_file = DATA_FILE.with_name(f'{DATA_FILE.name}.{uuid.uuid4().hex}.tmp')
    try:
        with temp_file.open('w', encoding='utf-8') as written_file:
            json.dump(data, written_file, indent=2)
            written_file.flush()
            os.fsync(written_file.fileno())
        temp_file.replace(DATA_FILE)
        saved_data = json.loads(DATA_FILE.read_text(encoding='utf-8'))
        if saved_data != data:
            raise OSError(f'Application data verification failed for {DATA_FILE}.')
    finally:
        temp_file.unlink(missing_ok=True)


def load_auth_data():
    if not DATA_FILE.exists():
        seed_data()
    try:
        data = json.loads(DATA_FILE.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise OSError(f'Could not read application data from {DATA_FILE}.') from error
    if not isinstance(data, dict):
        raise OSError(f'Application data in {DATA_FILE} must be a JSON object.')
    return data


def serialize_profile(profile):
    if not profile:
        return profile
    clean = profile.copy()
    clean.pop('password_hash', None)
    return clean


def find_profile_by_email(data, email, role=None):
    normalized_email = str(email or '').strip().casefold()
    normalized_role = str(role or '').strip().casefold() if role is not None else None
    for profile in data.get('profiles', []):
        if (
            str(profile.get('email') or '').strip().casefold() == normalized_email
            and (normalized_role is None or str(profile.get('role') or '').strip().casefold() == normalized_role)
        ):
            return profile
    return None


def find_profile_by_id(data, profile_id):
    for profile in data.get('profiles', []):
        if profile.get('id') == profile_id:
            return profile
    return None


def current_user_from_auth():
    token = (request.headers.get('Authorization', '') or '').replace('Bearer ', '').strip()
    if not token:
        token = request.headers.get('X-User-Token') or ''
    if not token:
        return None
    data = load_auth_data()
    for session in data.get('sessions', []):
        if session.get('token') == token:
            return find_profile_by_id(data, session.get('user_id')) or session.get('user')
    return None


def authorize_roles(*allowed_roles):
    user = current_user_from_auth()
    if not user:
        return None, (jsonify({'error': 'Authentication required'}), 401)
    if user.get('role') not in allowed_roles:
        return None, (jsonify({'error': 'Access denied'}), 403)
    return user, None


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'ok': True, 'status': 'healthy'})


@app.route('/api/auth/register', methods=['POST'])
def register_user():
    payload = request.get_json(silent=True) or {}
    required = ['full_name', 'email', 'password', 'role']
    missing = [field for field in required if not payload.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    role = str(payload['role']).strip().lower()
    if role not in ROLE_VALUES - {'admin'}:
        return jsonify({'error': 'Admin access is reserved for the platform administrator. Select a standard account role.'}), 400

    email = str(payload['email']).strip().lower()
    with DATA_SAVE_LOCK:
        data = load_auth_data()
        if find_profile_by_email(data, email):
            return jsonify({'error': 'An account with this email already exists. Please sign in.'}), 409

        profile = {
            'id': f'user-{uuid.uuid4().hex[:8]}',
            'full_name': str(payload['full_name']).strip(),
            'email': email,
            'phone': payload.get('phone', ''),
            'role': role,
            'organization_name': payload.get('organization_name', ''),
            'address': payload.get('address', ''),
            'city': payload.get('city', ''),
            'profile_image': payload.get('profile_image', ''),
            'password_hash': hash_password(str(payload['password'])),
            'created_at': utc_now(),
        }
        data.setdefault('profiles', []).append(profile)
        data.setdefault('notifications', []).append({
            'id': f'notify-{uuid.uuid4().hex[:8]}',
            'user_id': profile['id'],
            'message': 'Welcome! Your account has been created successfully.',
            'type': 'welcome',
            'link': '/dashboard',
            'read_at': None,
            'created_at': utc_now(),
        })
        token = uuid.uuid4().hex
        data.setdefault('sessions', []).append({
            'token': token,
            'user_id': profile['id'],
            'created_at': utc_now(),
        })
        write_data_file_atomically(data)

    return jsonify({'token': token, 'user': serialize_profile(profile)}), 201


@app.route('/api/auth/login', methods=['POST'])
def login_user():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get('email') or '').strip().lower()
    password = payload.get('password') or ''
    requested_role = payload.get('role')
    if requested_role is not None:
        requested_role = str(requested_role).strip().lower()
        if requested_role not in ROLE_VALUES:
            return jsonify({'error': 'Select a valid account role.'}), 400

    if not isinstance(password, str) or not password.strip():
        return jsonify({'error': 'Password is required.'}), 400
    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    if requested_role == 'admin':
        return jsonify({'error': 'Select a valid account role.'}), 400

    with DATA_SAVE_LOCK:
        data = load_auth_data()
        profiles = data.setdefault('profiles', [])
        matching_profiles = [
            profile for profile in profiles
            if str(profile.get('email') or '').strip().casefold() == email.casefold()
        ]
        profile = next(
            (
                candidate for candidate in matching_profiles
                if requested_role is not None
                and str(candidate.get('role') or '').strip().casefold() == requested_role
            ),
            matching_profiles[0] if matching_profiles else None,
        )
        created = profile is None
        if created:
            profile = {
                'id': f'user-{uuid.uuid4().hex[:8]}',
                'full_name': email.split('@', 1)[0],
                'email': email,
                'phone': '',
                'role': requested_role or 'donor',
                'organization_name': '',
                'address': '',
                'city': '',
                'profile_image': '',
                'password_hash': hash_password(password),
                'created_at': utc_now(),
            }
            profiles.append(profile)
            data.setdefault('notifications', []).append({
                'id': f'notify-{uuid.uuid4().hex[:8]}',
                'user_id': profile['id'],
                'message': 'Welcome! Your account has been created successfully.',
                'type': 'welcome',
                'link': '/dashboard',
                'read_at': None,
                'created_at': utc_now(),
            })
        elif requested_role is not None:
            profile['role'] = requested_role

        token = uuid.uuid4().hex
        data.setdefault('sessions', []).append({
            'token': token,
            'user_id': profile['id'],
            'created_at': utc_now(),
        })
        write_data_file_atomically(data)

    return jsonify({'token': token, 'user': serialize_profile(profile)}), 200


@app.route('/api/auth/switch-role', methods=['POST'])
def switch_role():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    payload = request.get_json(silent=True) or {}
    role = str(payload.get('role') or '').strip().lower()
    if role not in ROLE_VALUES - {'admin'}:
        return jsonify({'error': 'Select a valid account role.'}), 400

    current_token = (request.headers.get('Authorization', '') or '').replace('Bearer ', '').strip()
    with DATA_SAVE_LOCK:
        data = load_auth_data()
        profile = find_profile_by_id(data, user['id'])
        if not profile:
            return jsonify({'error': 'Authentication required'}), 401
        profile['role'] = role
        token = uuid.uuid4().hex
        data['sessions'] = [
            session for session in data.get('sessions', [])
            if session.get('token') != current_token
        ]
        data.setdefault('sessions', []).append({
            'token': token,
            'user_id': profile['id'],
            'created_at': utc_now(),
        })
        write_data_file_atomically(data)
    return jsonify({'token': token, 'user': serialize_profile(profile)})


@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    payload = request.get_json(silent=True) or {}
    email = (payload.get('email') or '').strip().lower()
    if not email:
        return jsonify({'error': 'Email is required for password recovery.'}), 400
    return jsonify({'success': True, 'message': 'Demo recovery is enabled. Please sign in with your account credentials or use the reset flow in the local demo environment.'})


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    return jsonify({'user': serialize_profile(user)})


@app.route('/api/auth/logout', methods=['POST'])
def logout_user():
    token = (request.headers.get('Authorization', '') or '').replace('Bearer ', '').strip() or request.headers.get('X-User-Token', '')
    if token:
        with DATA_SAVE_LOCK:
            data = load_auth_data()
            data['sessions'] = [
                session for session in data.get('sessions', [])
                if session.get('token') != token
            ]
            write_data_file_atomically(data)
    return jsonify({'success': True, 'message': 'Logged out successfully.'})


@app.route('/api/dashboard/overview', methods=['GET'])
def dashboard_overview():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    data = load_data()
    donations = data.get('donations', [])
    donation_requests = data.get('donation_requests', [])
    needs = data.get('community_needs', [])
    notifications = [n for n in data.get('notifications', []) if n['user_id'] == user['id']]

    if user['role'] == 'donor':
        donor_donations = [d for d in donations if d['donor_id'] == user['id']]
        donor_requests = [r for r in donation_requests if any(d['id'] == r['donation_id'] and d['donor_id'] == user['id'] for d in donor_donations)]
        stats = {
            'total_donations': len(donor_donations),
            'completed_donations': sum(1 for d in donor_donations if d['status'] == 'completed'),
            'pending_requests': sum(1 for r in donor_requests if r['status'] == 'pending'),
            'estimated_meals': sum(int(d.get('servings', 0) or 0) for d in donor_donations if d['status'] in {'available', 'requested', 'accepted', 'completed'}),
            'notifications': len(notifications),
        }
        recent_activity = [
            donation for donation in donor_donations
            if not donation_is_expired(donation)
        ][:3]
        return jsonify({'stats': stats, 'recent_activity': recent_activity})

    if user['role'] == 'requester':
        own_requests = [
            r for r in donation_requests
            if r.get('requester_id', r.get('ngo_id')) == user['id']
        ]
        requester_contributions = [
            item for item in data.get('request_contributions', [])
            if any(item.get('request_id') == request_item.get('id') for request_item in own_requests)
            and item.get('status') not in {'cancelled', 'rejected'}
        ]
        requested_by_unit = {}
        fulfilled_by_unit = {}
        donations_by_id = {item.get('id'): item for item in donations}
        for request_item in own_requests:
            linked_donation = donations_by_id.get(request_item.get('donation_id'), {})
            unit = str(request_item.get('quantity_unit') or linked_donation.get('quantity_unit') or 'units').strip()
            requested_by_unit[unit] = requested_by_unit.get(unit, 0) + float(request_item.get('requested_quantity', 0) or 0)
            if not request_item.get('multi_contribution') and request_item.get('status') in {'completed', 'fulfilled'}:
                fulfilled_by_unit[unit] = fulfilled_by_unit.get(unit, 0) + float(request_item.get('requested_quantity', 0) or 0)
        for contribution in requester_contributions:
            if contribution.get('status') == 'delivered':
                unit = str(contribution.get('quantity_unit') or 'units').strip()
                fulfilled_by_unit[unit] = fulfilled_by_unit.get(unit, 0) + float(contribution.get('quantity', 0) or 0)
        remaining_by_unit = {
            unit: max(0, quantity - fulfilled_by_unit.get(unit, 0))
            for unit, quantity in requested_by_unit.items()
        }
        format_quantities = lambda values: ', '.join(
            f'{quantity:g} {unit}' for unit, quantity in sorted(values.items()) if quantity
        ) or '0'
        stats = {
            'available_donations': sum(1 for donation in donations if donation_is_requestable(data, donation)),
            'submitted_requests': len(own_requests),
            'approved_requests': sum(1 for r in own_requests if r['status'] == 'approved'),
            'completed_distributions': sum(1 for r in own_requests if r['status'] == 'completed'),
            'requested_quantity': format_quantities(requested_by_unit),
            'fulfilled_quantity': format_quantities(fulfilled_by_unit),
            'remaining_quantity': format_quantities(remaining_by_unit),
            'estimated_meals': sum(int(r.get('requested_quantity', 0) or 0) for r in own_requests if r['status'] in {'approved', 'completed'}),
            'notifications': len(notifications),
        }
        return jsonify({'stats': stats, 'recent_activity': own_requests[:3]})

    if user['role'] == 'volunteer':
        tasks = [
            task for task in data.get('delivery_tasks', [])
            if task.get('volunteer_id') == user['id']
        ]
        stats = {
            'available_tasks': len([task for task in data.get('delivery_tasks', []) if task.get('status') == 'open']),
            'active_deliveries': len([task for task in tasks if task.get('status') in {'assigned', 'accepted', 'picked_up', 'in_transit'}]),
            'completed_deliveries': sum(1 for task in tasks if task.get('status') == 'delivered'),
            'notifications': len(notifications),
        }
        return jsonify({'stats': stats, 'recent_activity': tasks[-3:]})

    if user['role'] == 'ngo':
        own_legacy_requests = [r for r in donation_requests if r.get('ngo_id') == user['id'] and not r.get('requester_id')]
        incoming_requests = [
            r for r in donation_requests
            if r.get('requester_id')
            and r.get('coordinating_ngo_id') in (None, user['id'])
        ]
        tasks = [task for task in data.get('delivery_tasks', []) if task.get('ngo_id') == user['id']]
        stats = {
            'available_donations': sum(1 for donation in donations if donation_is_requestable(data, donation)),
            'incoming_requests': len(incoming_requests),
            'pending_requests': sum(1 for r in incoming_requests if r.get('status') == 'pending'),
            'active_deliveries': sum(1 for task in tasks if task.get('status') != 'delivered'),
            'completed_distributions': sum(1 for task in tasks if task.get('status') == 'delivered'),
            'legacy_requests': len(own_legacy_requests),
            'notifications': len(notifications),
        }
        return jsonify({'stats': stats, 'recent_activity': tasks[-3:]})

    return jsonify({'stats': {
        'total_users': len(data['profiles']),
        'total_donations': len(donations),
        'total_requests': len(donation_requests),
        'active_needs': len(needs),
        'notifications': len(notifications),
    }, 'recent_activity': data.get('audit_logs', [])[-3:]})


@app.route('/api/dashboard/public-overview', methods=['GET'])
def public_dashboard_overview():
    data = load_data()
    now = datetime.now(timezone.utc)

    donations = [
        donation for donation in data.get('donations', [])
        if donation.get('status') not in {'cancelled', 'rejected'}
    ]
    meals_redistributed = sum(
        float(donation.get('servings', 0) or 0)
        * donation_distributed_quantity(data, donation)
        / float(donation.get('quantity', 0) or 1)
        for donation in donations
        if float(donation.get('quantity', 0) or 0) > 0
    )
    organizations_by_name = {}
    for profile in data.get('profiles', []):
        name = str(profile.get('organization_name') or '').strip()
        if profile.get('role') != 'ngo' or not name:
            continue
        organization_key = name.casefold()
        organizations_by_name.setdefault(organization_key, {
            'organization_name': name,
            'city': str(profile.get('city') or '').strip(),
        })
    organizations = sorted(
        organizations_by_name.values(),
        key=lambda organization: organization['organization_name'].casefold(),
    )
    organizations_by_id = {
        profile.get('id'): profile
        for profile in data.get('profiles', [])
        if profile.get('role') == 'ngo'
    }
    fulfilled_requests = sum(
        1 for request_item in data.get('donation_requests', [])
        if request_item.get('status') in {'completed', 'fulfilled'}
    )
    completed_donations = [
        donation for donation in donations
        if donation.get('status') == 'completed'
    ]
    active_donations = [
        donation for donation in donations
        if donation_is_requestable(data, donation)
    ]

    distributed_before_expiry = 0.0
    for donation in donations:
        expiry = donation_expiry_datetime(donation)
        if not expiry:
            continue
        donation_quantity_before_expiry = 0.0
        donation_id = donation.get('id')
        tasks = [
            task for task in data.get('delivery_tasks', [])
            if task.get('status') == 'delivered'
            and delivery_task_donation_id(data, task) == donation_id
        ]
        contributions_by_id = {
            item.get('id'): item for item in data.get('request_contributions', [])
        }
        requests_by_id = {
            item.get('id'): item for item in data.get('donation_requests', [])
        }
        delivered_task_ids = {task.get('id') for task in tasks}
        delivered_contribution_ids = {
            task.get('request_contribution_id')
            for task in tasks
            if task.get('request_contribution_id')
        }
        for task in tasks:
            delivered_at = next(
                (
                    item.get('created_at')
                    for item in task.get('status_history', [])
                    if item.get('status') == 'delivered'
                ),
                task.get('delivered_at') or task.get('updated_at'),
            )
            delivered_time = donation_datetime(delivered_at)
            if not delivered_time or delivered_time >= expiry:
                continue
            contribution = contributions_by_id.get(task.get('request_contribution_id'))
            request_item = requests_by_id.get(task.get('request_id'))
            quantity = task.get('quantity')
            if quantity is None:
                quantity = (
                    contribution.get('quantity', 0)
                    if contribution
                    else request_item.get('requested_quantity', 0) if request_item else 0
                )
            donation_quantity_before_expiry += float(quantity or 0)
        for contribution in data.get('request_contributions', []):
            if (
                contribution.get('donation_id') != donation_id
                or contribution.get('status') != 'delivered'
                or contribution.get('delivery_task_id') in delivered_task_ids
                or contribution.get('id') in delivered_contribution_ids
            ):
                continue
            delivered_time = donation_datetime(contribution.get('delivered_at'))
            if delivered_time and delivered_time < expiry:
                donation_quantity_before_expiry += float(contribution.get('quantity', 0) or 0)
        donation_quantity = float(donation.get('quantity', 0) or 0)
        donation_servings = float(donation.get('servings', 0) or 0)
        if donation_quantity > 0 and donation_servings > 0:
            distributed_before_expiry += donation_servings * min(
                donation_quantity_before_expiry,
                donation_distributed_quantity(data, donation),
            ) / donation_quantity

    community_needs = []
    needs_by_id = {}
    need_contributions = data.get('community_need_contributions', [])
    tasks_by_contribution = {
        task.get('community_contribution_id'): task
        for task in data.get('delivery_tasks', [])
        if task.get('community_contribution_id')
    }
    for need in data.get('community_needs', []):
        required_quantity = float(need.get('required_quantity', 0) or 0)
        delivered_quantity = sum(
            float(item.get('quantity', 0) or 0)
            for item in need_contributions
            if item.get('need_id') == need.get('id')
            and (
                item.get('status') == 'delivered'
                or (tasks_by_contribution.get(item.get('id')) or {}).get('status') == 'delivered'
            )
        )
        status = need.get('status', 'open')
        if required_quantity > 0 and delivered_quantity >= required_quantity:
            status = 'fulfilled'
        elif status == 'fulfilled':
            status = 'pending_delivery' if any(
                item.get('need_id') == need.get('id') for item in need_contributions
            ) else 'open'
        if status not in {'open', 'partial', 'pending_delivery'}:
            continue
        organization = organizations_by_id.get(need.get('ngo_id'), {})
        public_need = {
            'id': need.get('id'),
            'category': need.get('category', ''),
            'required_quantity': required_quantity,
            'delivered_quantity': delivered_quantity,
            'remaining_quantity': max(0, required_quantity - delivered_quantity),
            'servings': need.get('servings', 0),
            'location': need.get('location', ''),
            'city': need.get('city', ''),
            'urgency': need.get('urgency', ''),
            'required_date': need.get('required_date', ''),
            'description': need.get('description', ''),
            'status': status,
            'organization_name': organization.get('organization_name', ''),
            'created_at': need.get('created_at', ''),
        }
        community_needs.append(public_need)
        needs_by_id[need.get('id')] = public_need

    matches = []
    for donation in active_donations:
        donation_quantity = float(donation.get('quantity', 0) or 0)
        donation_available = float(donation_available_quantity(data, donation) or 0)
        donation_servings = float(donation.get('servings', 0) or 0)
        if donation_quantity <= 0 or donation_available <= 0 or donation_servings <= 0:
            continue
        available_servings = donation_servings * donation_available / donation_quantity
        donation_category = str(donation.get('category') or '').strip().casefold()
        donation_city = str(donation.get('city') or '').strip().casefold()
        if not donation_category or not donation_city:
            continue
        for need in community_needs:
            need_category = str(need.get('category') or '').strip().casefold()
            need_city = str(need.get('city') or '').strip().casefold()
            remaining_need = float(need.get('remaining_quantity', 0) or 0)
            if (
                donation_category != need_category
                or not need_city
                or donation_city != need_city
                or remaining_need <= 0
                or available_servings < remaining_need
            ):
                continue
            matches.append({
                'donation_id': donation.get('id'),
                'food_name': donation.get('food_name', ''),
                'category': donation.get('category', ''),
                'city': donation.get('city', ''),
                'available_quantity': donation_available,
                'quantity_unit': donation.get('quantity_unit', ''),
                'need_id': need.get('id'),
                'need_remaining_quantity': remaining_need,
                'organization_name': need.get('organization_name', ''),
            })

    opportunities = []
    for task in data.get('delivery_tasks', []):
        if task.get('status') != 'open':
            continue
        donation_id = delivery_task_donation_id(data, task)
        donation = next(
            (item for item in data.get('donations', []) if item.get('id') == donation_id),
            None,
        )
        need = needs_by_id.get(task.get('community_need_id'))
        if donation_id and (
            not donation or not donation_can_continue_distribution(data, donation)
        ):
            continue
        food_category = (
            donation.get('category', '') if donation
            else need.get('category', '') if need
            else ''
        )
        city = donation.get('city', '') if donation else need.get('city', '') if need else ''
        opportunities.append({
            'category': food_category,
            'city': city,
            'created_at': task.get('created_at', ''),
        })

    public_alerts = []
    for need in community_needs:
        if str(need.get('urgency') or '').casefold() in {'urgent', 'high', 'critical'}:
            public_alerts.append({
                'type': 'urgent_need',
                'message': f"Urgent community need: {need.get('category') or 'food'} in {need.get('city') or 'an unspecified location'}.",
                'created_at': need.get('created_at', ''),
            })
    for donation in active_donations:
        expiry = donation_expiry_datetime(donation)
        if not expiry:
            continue
        hours_left = (expiry - now).total_seconds() / 3600
        if 0 < hours_left <= 24:
            public_alerts.append({
                'type': 'expiring_food',
                'message': f"{donation.get('food_name') or 'A food listing'} in {donation.get('city') or 'an unspecified location'} expires within 24 hours.",
                'created_at': donation.get('available_until', ''),
            })
    public_alerts.sort(
        key=lambda item: item.get('created_at') or '',
        reverse=True,
    )
    volunteer_groups = {}
    for profile in data.get('profiles', []):
        volunteer_id = profile.get('id')
        if (
            profile.get('role') != 'volunteer'
            or not volunteer_id
            or str(profile.get('status') or '').strip().casefold()
            in {'inactive', 'disabled', 'deactivated', 'deleted', 'suspended'}
        ):
            continue

        phone_digits = re.sub(r'\D', '', str(profile.get('phone') or ''))
        if len(phone_digits) == 12 and phone_digits.startswith('91'):
            phone_digits = phone_digits[2:]
        elif len(phone_digits) == 11 and phone_digits.startswith('0'):
            phone_digits = phone_digits[1:]
        identity_key = f'phone:{phone_digits}' if phone_digits else f'id:{volunteer_id}'
        existing = volunteer_groups.get(identity_key)
        if not existing or str(profile.get('created_at') or '') > str(existing.get('created_at') or ''):
            volunteer_groups[identity_key] = profile

    volunteers = [
        {
            'id': profile['id'],
            'full_name': profile.get('full_name', ''),
            'city': profile.get('city', ''),
            'status': profile.get('status') or 'Registered',
        }
        for profile in volunteer_groups.values()
    ]

    return jsonify({
        'stats': {
            'total_donations': len(donations),
            'available_donations': len(active_donations),
            'meals_redistributed': round(meals_redistributed),
            'fulfilled_requests': fulfilled_requests,
            'connected_organizations': len(organizations),
            'completed_donations': len(completed_donations),
            'active_donations': len(active_donations),
            'meals_redistributed_before_expiry': round(distributed_before_expiry),
            'open_volunteer_opportunities': len(opportunities),
        },
        'organizations': organizations,
        'community_needs': community_needs,
        'matches': matches,
        'volunteers': volunteers,
        'volunteer_opportunities': opportunities,
        'alerts': public_alerts[:10],
    })


@app.route('/api/donations', methods=['GET'])
def list_donations():
    user = current_user_from_auth()
    data = load_data()
    public_scope = request.args.get('scope')
    if public_scope == 'public_dashboard':
        public_donations = [
            serialize_public_donation(data, donation)
            for donation in data.get('donations', [])
            if donation.get('status') not in {'cancelled', 'rejected'}
            and not donation_is_expired(donation)
        ]
        return jsonify({'donations': public_donations})
    if public_scope == 'public_available':
        public_donations = [
            serialize_public_donation(data, donation)
            for donation in data.get('donations', [])
            if public_donation_is_available(data, donation)
        ]
        return jsonify({'donations': public_donations})
    if not user:
        public_donations = [
            serialize_public_donation(data, donation)
            for donation in data.get('donations', [])
            if public_donation_is_available(data, donation)
        ]
        return jsonify({'donations': public_donations})
    if user['role'] == 'donor':
        donations = [
            donation for donation in data.get('donations', [])
            if donation['donor_id'] == user['id']
            and not donation_is_expired(donation)
        ]
    elif user['role'] in {'requester', 'ngo'}:
        donations = [
            serialize_public_donation(data, donation)
            for donation in data.get('donations', [])
            if donation_is_requestable(data, donation)
        ]
    elif user['role'] == 'volunteer':
        donations = []
    else:
        donations = [
            donation for donation in data.get('donations', [])
            if not donation_is_expired(donation)
        ]
    if user.get('role') == 'donor':
        donations_by_id = {item.get('id'): item for item in donations}
        tasks_by_id = {item.get('id'): item for item in data.get('delivery_tasks', [])}
        feedback_by_donation = {}
        for feedback in data.get('delivery_feedback', []):
            task = tasks_by_id.get(feedback.get('task_id'))
            donation_id = feedback.get('donation_id') or (
                delivery_task_donation_id(data, task) if task else None
            )
            donation = donations_by_id.get(donation_id)
            if not donation or donation.get('donor_id') != user.get('id'):
                continue
            feedback_by_donation.setdefault(donation_id, []).append(feedback)
        for donation in donations:
            donation['available_quantity'] = donation_available_quantity(data, donation)
            donation['cancellation_eligible'] = donation_cancellation_allowed(data, donation)
            donation['feedback'] = [
                {
                    key: value
                    for key, value in feedback.items()
                    if key not in {'author_id', 'author_name', 'receiver_id'}
                }
                for feedback in feedback_by_donation.get(donation.get('id'), [])
            ]
    if user.get('role') == 'ngo':
        profiles = {profile.get('id'): profile for profile in data.get('profiles', [])}
        for donation in donations:
            donor = profiles.get(donation.get('donor_id'), {})
            donation['donor_organization'] = donor.get('organization_name') or donor.get('full_name', '')
    for donation in donations:
        donation['available_quantity'] = donation_available_quantity(data, donation)
        donation['distributed_quantity'] = donation_distributed_quantity(data, donation)
        donation['remaining_quantity'] = donation_remaining_quantity(data, donation)
    return jsonify({'donations': donations})


@app.route('/api/donations', methods=['POST'])
def create_donation():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required to create a donation.'}), 401
    if user['role'] not in {'donor', 'admin'}:
        return jsonify({'error': 'Only donors can create donations.'}), 403

    payload = request.get_json(silent=True) or {}
    required = [
        'food_name', 'category', 'quantity', 'quantity_unit', 'preparation_time',
        'available_until', 'pickup_location', 'city',
    ]
    missing = [field for field in required if not payload.get(field)]
    if missing:
        field_labels = {
            'available_until': 'Food Expiry Date & Time',
        }
        missing_labels = [field_labels.get(field, field.replace('_', ' ').capitalize()) for field in missing]
        return jsonify({'error': f'Missing required fields: {", ".join(missing_labels)}'}), 400
    food_name = str(payload.get('food_name') or '').strip()
    if not food_name:
        return jsonify({'error': 'Food name is required.'}), 400
    image_url = str(payload.get('image_url') or '').strip()

    expiry_error = validate_food_expiry(payload['preparation_time'], payload['available_until'])
    if expiry_error:
        return jsonify({'error': expiry_error}), 400
    if donation_is_expired({'available_until': payload['available_until']}):
        return jsonify({'error': 'Food Expiry Date & Time must be in the future.'}), 400
    pickup_deadline = payload.get('pickup_available_until') or payload['available_until']
    pickup_error = validate_pickup_deadline(
        payload['preparation_time'],
        payload['available_until'],
        pickup_deadline,
    )
    if pickup_error:
        return jsonify({'error': pickup_error}), 400

    try:
        quantity = float(payload['quantity'])
        servings = int(payload.get('servings', quantity))
    except (TypeError, ValueError, OverflowError):
        return jsonify({'error': 'Quantity and estimated servings must be valid numbers.'}), 400
    if not math.isfinite(quantity) or quantity <= 0:
        return jsonify({'error': 'Quantity must be greater than zero.'}), 400
    if servings <= 0:
        return jsonify({'error': 'Estimated servings must be greater than zero.'}), 400

    preparation_time = donation_datetime(payload['preparation_time'])
    available_until = donation_datetime(payload['available_until'])
    pickup_available_until = donation_datetime(pickup_deadline)
    if not preparation_time or not available_until or not pickup_available_until:
        return jsonify({'error': 'Preparation, expiry, and pickup times must be valid date-time values.'}), 400
    preparation_time = preparation_time.astimezone(timezone.utc).isoformat()
    available_until = available_until.astimezone(timezone.utc).isoformat()
    pickup_available_until = pickup_available_until.astimezone(timezone.utc).isoformat()

    data = load_data()
    submission_key = request.headers.get('Idempotency-Key', '').strip()
    submission_keys = data.setdefault('donation_submission_keys', {})
    if submission_key:
        key = f'{user["id"]}:{submission_key}'
        existing_id = submission_keys.get(key)
        existing_donation = next(
            (item for item in data['donations'] if item['id'] == existing_id),
            None,
        )
        if existing_donation:
            return jsonify({'donation': existing_donation, 'duplicate': True}), 200

    donation = {
        'id': f'donation-{uuid.uuid4().hex}',
        'donor_id': user['id'],
        'food_name': food_name,
        'category': str(payload['category']).strip(),
        'description': payload.get('description', ''),
        'quantity': quantity,
        'quantity_unit': str(payload['quantity_unit']).strip(),
        'servings': servings,
        'is_veg': bool(payload.get('is_veg', True)),
        'image_url': image_url,
        'image_source': payload.get('image_source', ''),
        'preparation_time': preparation_time,
        'available_until': available_until,
        'pickup_available_until': pickup_available_until,
        'pickup_location': str(payload['pickup_location']).strip(),
        'city': str(payload['city']).strip(),
        'latitude': payload.get('latitude'),
        'longitude': payload.get('longitude'),
        'handling_instructions': payload.get('handling_instructions', ''),
        'contact_name': payload.get('contact_name', user['full_name']),
        'contact_phone': payload.get('contact_phone', user.get('phone', '')),
        'status': 'available',
        'created_at': utc_now(),
        'updated_at': utc_now(),
    }
    data['donations'].append(donation)
    if submission_key:
        submission_keys[f'{user["id"]}:{submission_key}'] = donation['id']
    data['donation_status_history'].append({
        'id': f'history-{uuid.uuid4().hex[:8]}',
        'donation_id': donation['id'],
        'previous_status': None,
        'new_status': 'available',
        'changed_by': user['id'],
        'note': 'Donation listed',
        'created_at': utc_now(),
    })
    data['notifications'].append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': user['id'],
        'message': f'Donation created successfully: {donation["food_name"]}.',
        'type': 'donation',
        'link': '/donor',
        'read_at': None,
        'created_at': utc_now(),
    })
    try:
        save_data(data)
    except OSError:
        app.logger.exception('Could not persist donation %s.', donation['id'])
        return jsonify({'error': 'The donation could not be saved. Please try again.'}), 500
    return jsonify({'donation': donation}), 201


@app.route('/api/donations/<donation_id>', methods=['GET'])
def get_donation(donation_id):
    user = current_user_from_auth()
    data = load_data()
    donation = next((d for d in data['donations'] if d['id'] == donation_id), None)
    if not donation or donation_is_expired(donation):
        return jsonify({'error': 'Donation not found'}), 404
    if user and (
        user.get('role') == 'admin'
        or (user.get('role') == 'donor' and donation.get('donor_id') == user.get('id'))
    ):
        donation['_history'] = [h for h in data['donation_status_history'] if h['donation_id'] == donation_id]
        donation['available_quantity'] = donation_available_quantity(data, donation)
        donation['distributed_quantity'] = donation_distributed_quantity(data, donation)
        donation['remaining_quantity'] = donation_remaining_quantity(data, donation)
        return jsonify({'donation': donation})
    if donation.get('status') in {'cancelled', 'rejected'}:
        return jsonify({'error': 'Donation not found'}), 404
    if not user or user.get('role') in {'donor', 'requester', 'ngo', 'volunteer'}:
        return jsonify({'donation': serialize_public_donation(data, donation)})
    return jsonify({'error': 'Donation not found'}), 404


@app.route('/api/donations/<donation_id>', methods=['PATCH'])
def update_donation(donation_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    if expire_due_donations(data):
        save_data(data)
    donation = next((d for d in data['donations'] if d['id'] == donation_id), None)
    if not donation:
        return jsonify({'error': 'Donation not found'}), 404
    if user['id'] != donation['donor_id'] and user['role'] != 'admin':
        return jsonify({'error': 'You can only edit your own donations.'}), 403

    payload = request.get_json(silent=True) or {}
    allowed_statuses = {
        'available', 'requested', 'accepted', 'collected', 'delivered',
        'completed', 'expired', 'rejected',
    }
    if 'status' in payload and payload['status'] not in allowed_statuses:
        return jsonify({'error': 'Invalid donation status. Use the cancellation endpoint to cancel a donation.'}), 400
    requested_status = payload.get('status', donation.get('status'))
    if donation.get('status') == 'expired' and requested_status != 'expired':
        return jsonify({'error': 'Expired donations cannot be reactivated.'}), 409
    if requested_status == 'expired' and not donation_is_expired(donation):
        return jsonify({'error': 'Donations expire automatically at their validity end time.'}), 409
    if requested_status == 'completed' and user.get('role') != 'admin':
        return jsonify({'error': 'Donations are marked completed only after delivery is confirmed.'}), 400
    if 'available_until' in payload or 'preparation_time' in payload:
        expiry_error = validate_food_expiry(
            payload.get('preparation_time', donation.get('preparation_time')),
            payload.get('available_until', donation.get('available_until')),
        )
        if expiry_error:
            return jsonify({'error': expiry_error}), 400
    if any(field in payload for field in ('pickup_available_until', 'available_until', 'preparation_time')):
        pickup_error = validate_pickup_deadline(
            payload.get('preparation_time', donation.get('preparation_time')),
            payload.get('available_until', donation.get('available_until')),
            payload.get('pickup_available_until', donation.get('pickup_available_until')),
        )
        if pickup_error:
            return jsonify({'error': pickup_error}), 400
    for key, value in payload.items():
        if key in {'id', 'donor_id', 'created_at'}:
            continue
        if key == 'status':
            continue
        donation[key] = value
    set_donation_status(data, donation, requested_status, user['id'], 'Donation status updated')
    donation['updated_at'] = utc_now()
    save_data(data)
    return jsonify({'donation': donation})


@app.route('/api/donations/<donation_id>/cancel', methods=['POST'])
def cancel_donation(donation_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    payload = request.get_json(silent=True) or {}
    reason = str(payload.get('reason') or '').strip()
    if not reason:
        return jsonify({'error': 'A cancellation reason is required.'}), 400
    if len(reason) > 1000:
        return jsonify({'error': 'Cancellation reason must be 1000 characters or fewer.'}), 400

    with DONATION_CANCELLATION_LOCK:
        data = load_data()
        donation = next(
            (item for item in data.get('donations', []) if item.get('id') == donation_id),
            None,
        )
        if not donation:
            return jsonify({'error': 'Donation not found.'}), 404
        if user.get('role') != 'donor' or donation.get('donor_id') != user.get('id'):
            return jsonify({'error': 'Only the donor who owns this donation can cancel it.'}), 403
        if expire_donation_if_due(data, donation):
            save_data(data)
            return jsonify({'error': 'Expired donations cannot be cancelled or reactivated.'}), 409
        if donation.get('status') == 'cancelled':
            return jsonify({'error': 'This donation has already been cancelled.'}), 409
        if not donation_cancellation_allowed(data, donation):
            return jsonify({'error': 'This donation can no longer be cancelled because it is delivered or has an in-progress pickup.'}), 409

        cancelled_at = utc_now()
        related_requests = [
            item for item in data.get('donation_requests', [])
            if item.get('donation_id') == donation_id
        ]
        related_contributions = [
            item for item in data.get('request_contributions', [])
            if item.get('donation_id') == donation_id
        ]
        related_request_ids = {
            item.get('id') for item in data.get('donation_requests', [])
            if item.get('donation_id') == donation_id
            or any(
                contribution.get('request_id') == item.get('id')
                for contribution in related_contributions
            )
        }
        related_requests = [
            item for item in data.get('donation_requests', [])
            if item.get('id') in related_request_ids
        ]
        contribution_ids = {item.get('id') for item in related_contributions}
        related_tasks = [
            task for task in data.get('delivery_tasks', [])
            if task.get('donation_id') == donation_id
            or task.get('request_contribution_id') in contribution_ids
        ]
        if any(task.get('status') in {'picked_up', 'in_transit', 'delivered'} for task in related_tasks):
            return jsonify({'error': 'This donation cannot be cancelled after pickup or delivery has started.'}), 409

        cancellations = data.setdefault('donation_cancellations', [])
        if any(item.get('donation_id') == donation_id for item in cancellations):
            return jsonify({'error': 'A cancellation record already exists for this donation.'}), 409

        for contribution in related_contributions:
            if contribution.get('status') not in {'delivered', 'cancelled', 'rejected'}:
                contribution['status'] = 'cancelled'
                contribution['updated_at'] = cancelled_at
                contribution['cancellation_reason'] = 'donation_cancelled'

        cancelled_task_ids = []
        for task in related_tasks:
            if task.get('status') not in {'open', 'assigned', 'accepted'}:
                continue
            previous_volunteer_id = task.get('volunteer_id')
            task['status'] = 'cancelled'
            task['cancellation_reason'] = reason
            task['cancelled_at'] = cancelled_at
            task['updated_at'] = cancelled_at
            task.setdefault('status_history', []).append({
                'status': 'cancelled',
                'changed_by': user['id'],
                'created_at': cancelled_at,
            })
            cancelled_task_ids.append(task.get('id'))
            if previous_volunteer_id:
                notify_user(
                    data,
                    previous_volunteer_id,
                    f'The {donation.get("food_name", "food")} delivery was cancelled by the donor. This task is no longer active.',
                )
            notify_user(
                data,
                task.get('ngo_id'),
                f'The donor cancelled {donation.get("food_name", "a donation")}; its delivery task was closed.',
            )

        for request_item in related_requests:
            request_id = request_item.get('id')
            request_item['cancelled_donation_id'] = donation_id
            request_item.setdefault('donation_reassignment_history', []).append({
                'from_donation_id': donation_id,
                'reason': reason,
                'created_at': cancelled_at,
            })
            if request_item.get('donation_id') == donation_id:
                request_item['donation_id'] = None
                request_item['multi_contribution'] = True
            delivered_quantity = request_delivered_quantity(data, request_item)
            next_status = (
                'fulfilled'
                if delivered_quantity >= float(request_item.get('requested_quantity', 0) or 0)
                else 'partially_fulfilled' if delivered_quantity > 0 else 'pending'
            )
            set_request_status(request_item, next_status, user['id'])
            notify_user(
                data,
                request_item.get('requester_id', request_item.get('ngo_id')),
                f'The donor cancelled the {donation.get("food_name", "food")} listing. Your request remains available for alternative donor contributions.',
            )

        donation['cancellation_reason'] = reason
        donation['cancelled_at'] = cancelled_at
        set_donation_status(data, donation, 'cancelled', user['id'], reason)
        cancellation = {
            'id': f'cancellation-{uuid.uuid4().hex[:10]}',
            'donation_id': donation_id,
            'donor_id': donation.get('donor_id'),
            'reason': reason,
            'created_at': cancelled_at,
            'updated_at': cancelled_at,
            'reassignment_status': 'alternative_needed' if related_request_ids else 'not_required',
            'request_ids': sorted(related_request_ids),
            'cancelled_task_ids': cancelled_task_ids,
            'replacement_donation_ids': [],
            'status_history': [{
                'status': 'cancelled',
                'created_at': cancelled_at,
                'changed_by': user['id'],
            }],
        }
        cancellations.append(cancellation)
        notify_user(
            data,
            donation.get('donor_id'),
            f'Your donation {donation_id} ({donation.get("food_name", "food")}) was cancelled successfully.',
            notification_type='donation',
        )
        save_data(data)

    return jsonify({'donation': donation, 'cancellation': cancellation})


@app.route('/api/donation-cancellations', methods=['GET'])
def list_donation_cancellations():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user.get('role') not in {'ngo', 'admin'}:
        return jsonify({'error': 'Only NGOs can view donor cancellation coordination.'}), 403

    data = load_data()
    donations_by_id = {item.get('id'): item for item in data.get('donations', [])}
    profiles_by_id = {item.get('id'): item for item in data.get('profiles', [])}
    requests_by_id = {item.get('id'): item for item in data.get('donation_requests', [])}
    entries = []
    for cancellation in data.get('donation_cancellations', []):
        donation = donations_by_id.get(cancellation.get('donation_id'))
        if not donation:
            continue
        related_requests = [
            requests_by_id[request_id]
            for request_id in cancellation.get('request_ids', [])
            if request_id in requests_by_id
        ]
        if user.get('role') == 'ngo' and related_requests and not any(
            item.get('coordinating_ngo_id') in (None, user.get('id'))
            or item.get('ngo_id') == user.get('id')
            for item in related_requests
        ):
            continue
        donor = profiles_by_id.get(donation.get('donor_id'), {})
        entries.append({
            **cancellation,
            'donation': {
                'id': donation.get('id'),
                'food_name': donation.get('food_name', ''),
                'category': donation.get('category', ''),
                'quantity': donation.get('quantity', 0),
                'quantity_unit': donation.get('quantity_unit', ''),
                'pickup_location': donation.get('pickup_location', ''),
            },
            'donor_name': donor.get('organization_name') or donor.get('full_name', 'Donor'),
            'requests': [{
                'id': item.get('id'),
                'food_name': item.get('food_name') or donation.get('food_name', ''),
                'requested_quantity': item.get('requested_quantity', 0),
                'quantity_unit': item.get('quantity_unit', ''),
                'status': item.get('status', 'pending'),
                'coordinating_ngo_id': item.get('coordinating_ngo_id'),
            } for item in related_requests],
        })
    entries.sort(key=lambda item: item.get('created_at', ''), reverse=True)
    return jsonify({'cancellations': entries})


@app.route('/api/donation-cancellations/<cancellation_id>/coordinate', methods=['POST'])
def coordinate_donation_cancellation(cancellation_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user.get('role') != 'ngo':
        return jsonify({'error': 'Only NGOs can coordinate alternative arrangements.'}), 403

    data = load_data()
    cancellation = next(
        (item for item in data.get('donation_cancellations', []) if item.get('id') == cancellation_id),
        None,
    )
    if not cancellation:
        return jsonify({'error': 'Donation cancellation not found.'}), 404
    requests_by_id = {item.get('id'): item for item in data.get('donation_requests', [])}
    related_requests = [
        requests_by_id[request_id]
        for request_id in cancellation.get('request_ids', [])
        if request_id in requests_by_id
    ]
    if not related_requests:
        return jsonify({'error': 'There are no active food requests requiring reassignment.'}), 409
    if any(
        item.get('coordinating_ngo_id') not in (None, user.get('id'))
        and item.get('status') not in {'fulfilled', 'completed', 'cancelled', 'rejected'}
        for item in related_requests
    ):
        return jsonify({'error': 'A related food request is coordinated by another organization.'}), 403

    previous_status = cancellation.get('reassignment_status')
    for request_item in related_requests:
        if request_item.get('status') in {'fulfilled', 'completed', 'cancelled', 'rejected'}:
            continue
        request_item['coordinating_ngo_id'] = user['id']
        request_item['updated_at'] = utc_now()
    cancellation['coordinating_ngo_id'] = user['id']
    if previous_status == 'alternative_needed':
        cancellation['reassignment_status'] = 'coordinating'
    cancellation['updated_at'] = utc_now()
    if cancellation.get('reassignment_status') != previous_status:
        cancellation.setdefault('status_history', []).append({
            'status': cancellation['reassignment_status'],
            'created_at': cancellation['updated_at'],
            'changed_by': user['id'],
        })
    save_data(data)
    return jsonify({'cancellation': cancellation})


@app.route('/api/donations/<donation_id>', methods=['DELETE'])
def delete_donation(donation_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    data = load_data()
    donation = next((item for item in data.get('donations', []) if item.get('id') == donation_id), None)
    if not donation:
        return jsonify({'error': 'Donation not found'}), 404
    if donation.get('status') == 'expired':
        return jsonify({'error': 'Expired donations are retained for history and cannot be deleted.'}), 409
    is_owner = user['id'] == donation.get('donor_id')
    if not (is_owner or user.get('role') == 'admin'):
        return jsonify({'error': 'You are not authorized to delete this donation.'}), 403

    deleted_task_ids = {
        item.get('id')
        for item in data.get('delivery_tasks', [])
        if item.get('donation_id') == donation_id
    }
    data['donations'] = [item for item in data.get('donations', []) if item.get('id') != donation_id]
    for collection in ('donation_requests', 'donation_status_history', 'distribution_records', 'donation_certificates', 'delivery_tasks'):
        data[collection] = [item for item in data.get(collection, []) if item.get('donation_id') != donation_id]
    data['delivery_feedback'] = [
        item for item in data.get('delivery_feedback', [])
        if item.get('task_id') not in deleted_task_ids
    ]
    data['donation_submission_keys'] = {
        key: value
        for key, value in data.get('donation_submission_keys', {}).items()
        if value != donation_id
    }
    data.setdefault('audit_logs', []).append({
        'id': f'audit-{uuid.uuid4().hex}',
        'user_id': user['id'],
        'action': 'donation_deleted',
        'entity_type': 'donation',
        'entity_id': donation_id,
        'details': {'food_name': donation.get('food_name', '')},
        'created_at': utc_now(),
    })
    save_data(data)
    return jsonify({'success': True, 'deleted_id': donation_id})


def _food_terms(value):
    normalized_value = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', value)
    tokens = re.findall(r'[a-z0-9]+', normalized_value.lower())
    normalized = []
    for token in tokens:
        if token.endswith('ies') and len(token) > 3:
            normalized.append(f'{token[:-3]}y')
        elif token.endswith('s') and len(token) > 3:
            normalized.append(token[:-1])
        else:
            normalized.append(token)
    return normalized


def _food_image_score(food_name, page):
    requested_terms = _food_terms(food_name)
    title = re.sub(r'^[^:]+:', '', str(page.get('title') or ''), count=1)
    title = re.sub(r'\.[a-z0-9]{2,5}$', '', title, flags=re.IGNORECASE)
    full_title_terms = _food_terms(title)
    subject_title = re.split(r'[,;:!?]|\.(?=\s|$)', title, maxsplit=1)[0]
    title_terms = _food_terms(subject_title)
    if not requested_terms:
        return None

    excluded_title_terms = {
        'interior', 'logo', 'menu', 'poster', 'sign', 'icon', 'advertisement',
        'illustration', 'illustrated', 'drawing', 'cartoon', 'vector', 'clip',
        'packaging', 'pack', 'packing', 'packed', 'machine', 'make', 'making', 'prepare', 'preparing',
        'sieve', 'sieving', 'extract', 'extraction', 'recipe', 'process',
        'production', 'bean', 'leaf', 'plant', 'field', 'cafe',
        'cafeteria', 'shop', 'center', 'centre', 'bar', 'restaurant', 'hotel',
        'market', 'store', 'stall', 'building', 'street', 'foodbank', 'brand',
        'company', 'chain', 'office', 'screenshot',
    }
    if excluded_title_terms.intersection(full_title_terms):
        return None
    if '&' in title and '&' not in food_name:
        return None

    title_lead_ins = {
        'a', 'an', 'the', 'of', 'home', 'homemade', 'made', 'plate', 'bowl',
        'glass', 'cup', 'mug', 'jar', 'bottle', 'jug', 'pot', 'serving',
        'portion', 'piece', 'slice', 'dish', 'close', 'up', 'photo', 'picture',
        'image', 'fresh', 'traditional', 'prepared', 'cooked', 'with', 'served',
        'in', 'on', 'style',
    }
    scores = []
    for index in range(len(title_terms) - len(requested_terms) + 1):
        if title_terms[index:index + len(requested_terms)] != requested_terms:
            continue
        preceding_terms = [term for term in title_terms[:index] if term not in title_lead_ins]
        has_container_context = (
            index >= 2
            and title_terms[index - 1] == 'of'
            and title_terms[index - 2] in {'glass', 'cup', 'mug', 'jar', 'bottle', 'jug'}
        )
        if index and title_terms[index - 1] in {'on', 'about', 'near', 'under', 'beside'}:
            continue
        if len(preceding_terms) <= 1 or has_container_context:
            scores.append(sum(
                term not in requested_terms and term not in title_lead_ins
                for term in title_terms
            ))
    return min(scores) if scores else None


def _cached_food_image(food_name):
    cache_key = ' '.join(food_name.casefold().split())
    with FOOD_IMAGE_CACHE_LOCK:
        cached_image = FOOD_IMAGE_CACHE.get(cache_key)
        if cached_image:
            expires_at, image_url = cached_image
            if expires_at > time.monotonic():
                return image_url
            del FOOD_IMAGE_CACHE[cache_key]
    return None


def _cache_food_image(food_name, image_url):
    cache_key = ' '.join(food_name.casefold().split())
    with FOOD_IMAGE_CACHE_LOCK:
        if len(FOOD_IMAGE_CACHE) >= 256:
            FOOD_IMAGE_CACHE.pop(next(iter(FOOD_IMAGE_CACHE)))
        FOOD_IMAGE_CACHE[cache_key] = (
            time.monotonic() + FOOD_IMAGE_CACHE_TTL_SECONDS,
            image_url,
        )


def _image_bytes_extension(image_bytes):
    if image_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
        return '.png'
    if image_bytes.startswith(b'\xff\xd8\xff'):
        return '.jpg'
    if image_bytes.startswith(b'RIFF') and image_bytes[8:12] == b'WEBP':
        return '.webp'
    return None


@app.route('/api/food-image', methods=['GET'])
@app.route('/api/images/search', methods=['GET'])
def search_food_image():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    food_name = (request.args.get('food_name') or request.args.get('query') or '').strip()
    if not food_name:
        return jsonify({'error': 'A food name is required.'}), 400
    if len(food_name) > 100:
        return jsonify({'error': 'Food name must be 100 characters or fewer.'}), 400

    cached_image = _cached_food_image(food_name)
    if cached_image:
        return jsonify({'image_url': cached_image, 'source': 'image_provider'})

    search_queries = (
        f'filetype:bitmap "{food_name}" food',
        f'filetype:bitmap "{food_name}" drink',
        f'filetype:bitmap "{food_name}" beverage',
        f'filetype:bitmap "glass of {food_name}"',
    )
    best_image = None
    for search_query in search_queries:
        try:
            response = requests.get(
                'https://commons.wikimedia.org/w/api.php',
                params={
                    'action': 'query',
                    'generator': 'search',
                    'gsrsearch': search_query,
                    'gsrnamespace': 6,
                    'gsrlimit': 50,
                    'prop': 'imageinfo',
                    'iiprop': 'url',
                    'iiurlwidth': 900,
                    'format': 'json',
                },
                headers={
                    'User-Agent': (
                        'SmartFoodRedistribution/1.0 '
                        '(https://github.com/sandhya24sana/smart-food-donation-redistribution)'
                    ),
                },
                timeout=8,
            )
            response.raise_for_status()
            pages = response.json().get('query', {}).get('pages', {}).values()
            candidates = []
            for page in pages:
                score = _food_image_score(food_name, page)
                if score is None:
                    continue
                image_info = (page.get('imageinfo') or [{}])[0]
                image_url = image_info.get('thumburl') or image_info.get('url')
                if isinstance(image_url, str):
                    parsed_image_url = urlsplit(image_url)
                else:
                    parsed_image_url = None
                if (
                    parsed_image_url
                    and parsed_image_url.scheme == 'https'
                    and parsed_image_url.hostname in {'upload.wikimedia.org', 'thumb.wikimedia.org'}
                ):
                    candidates.append((score, image_url))
            if candidates:
                candidate = min(candidates, key=lambda item: item[0])
                if best_image is None or candidate[0] < best_image[0]:
                    best_image = candidate
                if best_image[0] == 0:
                    break
        except requests.RequestException as error:
            app.logger.warning('Food image lookup failed: %s', error)
            break
        except (ValueError, TypeError, AttributeError) as error:
            app.logger.warning('Food image lookup returned invalid data: %s', error)

    if best_image:
        _, image_url = best_image
        _cache_food_image(food_name, image_url)
        return jsonify({'image_url': image_url, 'source': 'image_provider'})
    return jsonify({'image_url': None, 'source': 'placeholder'})

@app.route('/api/donation-requests', methods=['GET'])
def list_requests():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user['role'] == 'volunteer':
        return jsonify({'error': 'Volunteers use delivery tasks, not food requests.'}), 403
    data = load_data()
    if user['role'] == 'requester':
        requests_list = [
            r for r in data.get('donation_requests', [])
            if r.get('requester_id', r.get('ngo_id')) == user['id']
        ]
    elif user['role'] == 'ngo':
        requests_list = [
            r for r in data.get('donation_requests', [])
            if (
                r.get('requester_id')
                and r.get('coordinating_ngo_id') in (None, user['id'])
            ) or (
                not r.get('requester_id') and r.get('ngo_id') == user['id']
            )
        ]
    elif user['role'] == 'donor':
        donor_ids = [d['id'] for d in data['donations'] if d['donor_id'] == user['id']]
        contributed_request_ids = {
            item.get('request_id')
            for item in data.get('request_contributions', [])
            if item.get('donor_id') == user['id']
        }
        active_request_statuses = {'pending', 'approved', 'accepted', 'partially_fulfilled'}
        requests_list = [
            r for r in data['donation_requests']
            if r.get('donation_id') in donor_ids
            or r.get('id') in contributed_request_ids
            or r.get('status') in active_request_statuses
        ]
    else:
        requests_list = data['donation_requests']

    donations_by_id = {item.get('id'): item for item in data.get('donations', [])}
    profiles_by_id = {item.get('id'): item for item in data.get('profiles', [])}
    tasks_by_contribution = {
        item.get('request_contribution_id'): item
        for item in data.get('delivery_tasks', [])
        if item.get('request_contribution_id')
    }
    feedback_by_task = {}
    for item in data.get('delivery_feedback', []):
        feedback_by_task.setdefault(item.get('task_id'), []).append(item)
    issues_by_task = {}
    for item in data.get('delivery_issues', []):
        issues_by_task.setdefault(item.get('task_id'), []).append(item)
    for request_item in requests_list:
        donation = donations_by_id.get(request_item.get('donation_id'))
        request_item['multi_contribution'] = bool(
            request_item.get('multi_contribution') or not request_item.get('donation_id')
        )
        receiver = profiles_by_id.get(
            request_item.get('requester_id', request_item.get('ngo_id')),
            {},
        )
        request_item['receiver_name'] = (
            receiver.get('organization_name') or receiver.get('full_name', '')
        )
        request_item['receiver_city'] = receiver.get('city', '')
        if donation:
            request_item.setdefault('quantity_unit', donation.get('quantity_unit', ''))
            request_item.setdefault('food_name', donation.get('food_name', ''))
            request_item.setdefault('category', donation.get('category', ''))
            donor = profiles_by_id.get(donation.get('donor_id'), {})
            donation_details = {
                'food_name': donation.get('food_name', ''),
                'category': donation.get('category', ''),
                'image_url': donation.get('image_url', ''),
                'image_source': donation.get('image_source', ''),
                'pickup_location': donation.get('pickup_location', ''),
                'city': donation.get('city', ''),
                'handling_instructions': donation.get('handling_instructions', ''),
                'contact_name': donation.get('contact_name', ''),
                'contact_phone': donation.get('contact_phone', ''),
                'available_until': donation.get('available_until', ''),
                'pickup_available_until': donation.get('pickup_available_until', ''),
                'status': donation.get('status', ''),
                'distributed_quantity': donation_distributed_quantity(data, donation),
                'remaining_quantity': donation_remaining_quantity(data, donation),
            }
            if user.get('role') == 'ngo':
                donation_details.update({
                    'quantity': donation.get('quantity', 0),
                    'quantity_unit': donation.get('quantity_unit', ''),
                    'status': donation.get('status', ''),
                    'donor_name': donor.get('full_name', ''),
                    'donor_organization': donor.get('organization_name', ''),
                })
            if user.get('role') == 'donor' and donation.get('donor_id') != user.get('id'):
                donation_details = {'food_name': donation.get('food_name', '')}
            request_item['donation'] = donation_details
        request_item.setdefault('category', '')
        if user.get('role') == 'donor':
            donor_inventory = [
                item for item in data.get('donations', [])
                if item.get('donor_id') == user['id']
                and donation_is_requestable(data, item)
                and donation_matches_food_request(item, request_item)
            ]
            request_item['donor_available_quantity'] = sum(
                donation_available_quantity(data, item)
                for item in donor_inventory
            )
            request_item['donor_can_fulfill_quantity'] = min(
                request_item['donor_available_quantity'],
                max(0, float(request_item.get('requested_quantity', 0) or 0)
                    - sum(
                        float(contribution.get('quantity', 0) or 0)
                        for contribution in data.get('request_contributions', [])
                        if contribution.get('request_id') == request_item.get('id')
                        and contribution.get('status') not in {'cancelled', 'rejected'}
                    )),
            )
        contributions = [
            item for item in data.get('request_contributions', [])
            if item.get('request_id') == request_item.get('id')
        ]
        request_item['contributed_quantity'] = sum(
            float(item.get('quantity', 0) or 0)
            for item in contributions
            if item.get('status') not in {'cancelled', 'rejected'}
        )
        request_item['delivered_quantity'] = request_delivered_quantity(data, request_item)
        if not request_item.get('multi_contribution'):
            if request_item.get('status') in {'approved', 'completed', 'fulfilled'}:
                request_item['contributed_quantity'] = float(request_item.get('requested_quantity', 0) or 0)
        request_item['remaining_quantity'] = max(
            0,
            float(request_item.get('requested_quantity', 0) or 0)
            - request_item['contributed_quantity'],
        )
        request_item['remaining_to_deliver_quantity'] = max(
            0,
            float(request_item.get('requested_quantity', 0) or 0)
            - request_item['delivered_quantity'],
        )
        requested_quantity = float(request_item.get('requested_quantity', 0) or 0)
        if request_item.get('status') not in {'cancelled', 'rejected'}:
            if requested_quantity > 0 and request_item['delivered_quantity'] >= requested_quantity:
                request_item['status'] = 'fulfilled'
            elif request_item['delivered_quantity'] > 0:
                request_item['status'] = 'partially_fulfilled'
            elif request_item.get('status') in {'completed', 'fulfilled', 'partially_fulfilled'}:
                request_item['status'] = 'pending'
        request_item['pending_delivery'] = request_has_pending_delivery(data, request_item)
        request_item['out_of_stock'] = bool(
            request_item['remaining_to_deliver_quantity'] > 0
            and request_item['status'] not in {'fulfilled', 'completed', 'cancelled', 'rejected'}
            and not request_item['pending_delivery']
            and not request_has_available_food(data, request_item)
        )
        if request_item.get('multi_contribution'):
            visible_contributions = contributions
            if user['role'] == 'donor':
                visible_contributions = [
                    item for item in contributions if item.get('donor_id') == user['id']
                ]
            request_item['contributions'] = []
            for contribution in visible_contributions:
                donor = profiles_by_id.get(contribution.get('donor_id'), {})
                contribution_donation = donations_by_id.get(contribution.get('donation_id'), {})
                task = tasks_by_contribution.get(contribution.get('id'))
                volunteer = profiles_by_id.get(task.get('volunteer_id'), {}) if task else {}
                request_item['contributions'].append({
                    **contribution,
                    'donor_name': donor.get('full_name', ''),
                    'food_name': contribution_donation.get('food_name', ''),
                    'category': contribution_donation.get('category', ''),
                    'image_url': contribution_donation.get('image_url', ''),
                    'image_source': contribution_donation.get('image_source', ''),
                    'available_until': contribution_donation.get('available_until', ''),
                    'pickup_available_until': contribution_donation.get('pickup_available_until', ''),
                    'pickup_location': contribution_donation.get('pickup_location', ''),
                    'delivery_task_id': task.get('id') if task else None,
                    'delivery_status': task.get('status') if task else None,
                    'volunteer_name': volunteer.get('full_name', ''),
                })
        if user.get('role') in {'requester', 'ngo'}:
            related_contribution_ids = {
                item.get('id') for item in data.get('request_contributions', [])
                if item.get('request_id') == request_item.get('id')
            }
            request_tasks = [
                task for task in data.get('delivery_tasks', [])
                if task.get('request_id') == request_item.get('id')
                or task.get('request_contribution_id') in related_contribution_ids
            ]
            request_item['delivery_tasks'] = []
            for task in request_tasks:
                visible_feedback = [
                    entry for entry in feedback_by_task.get(task.get('id'), [])
                    if user.get('role') == 'ngo' or entry.get('author_id') == user.get('id')
                ]
                visible_issues = [
                    entry for entry in issues_by_task.get(task.get('id'), [])
                    if user.get('role') == 'ngo' or entry.get('receiver_id') == user.get('id')
                ]
                request_item['delivery_tasks'].append({
                    'id': task.get('id'),
                    'status': task.get('status'),
                    'delivered_at': task.get('updated_at') if task.get('status') == 'delivered' else None,
                    'feedback': visible_feedback,
                    'feedback_submitted': bool(feedback_by_task.get(task.get('id'))),
                    'issues': visible_issues,
                })
    return jsonify({'requests': requests_list})


@app.route('/api/donation-requests', methods=['POST'])
@serialize_request_contribution_updates
def create_request():
    user = current_user_from_auth()
    if not user or user['role'] != 'requester':
        return jsonify({'error': 'Only food requesters can submit food requests.'}), 403

    payload = request.get_json(silent=True) or {}
    schedule_error = validate_request_priority_schedule(
        payload.get('priority'),
        payload.get('required_date'),
        payload.get('required_time'),
    )
    if schedule_error:
        return jsonify({'error': schedule_error}), 400
    donation_id = payload.get('donation_id')
    requested_quantity = payload.get('requested_quantity')
    try:
        quantity_value = float(requested_quantity)
    except (TypeError, ValueError):
        return jsonify({'error': 'A valid requested quantity is required.'}), 400
    if not math.isfinite(quantity_value) or quantity_value <= 0:
        return jsonify({'error': 'Requested quantity must be positive.'}), 400
    delivery_location = str(payload.get('delivery_location') or '').strip()
    if not delivery_location:
        return jsonify({'error': 'A delivery location is required for a food request.'}), 400

    data = load_data()
    if expire_due_donations(data):
        save_data(data)
    donation = None
    if donation_id:
        donation = next((d for d in data['donations'] if d['id'] == donation_id), None)
        if not donation:
            return jsonify({'error': 'Donation not found.'}), 404
        if not donation_is_requestable(data, donation):
            return jsonify({'error': 'This donation is not available for new requests.'}), 400
    else:
        if not str(payload.get('quantity_unit') or '').strip():
            return jsonify({'error': 'A quantity unit is required for a food request.'}), 400

    if donation:
        available_quantity = donation_available_quantity(data, donation)
        if quantity_value > available_quantity:
            unit = str(donation.get('quantity_unit') or 'units')
            if available_quantity == 1:
                unit = {
                    'meals': 'meal',
                    'servings': 'serving',
                    'packets': 'packet',
                    'boxes': 'box',
                    'kilograms': 'kilogram',
                }.get(unit.casefold(), unit)
            availability_verb = 'is' if available_quantity == 1 else 'are'
            available_display = f'{available_quantity:g}'
            return jsonify({
                'error': f'Only {available_display} {unit} {availability_verb} currently available. Please reduce your requested quantity.',
            }), 409

    quantity_unit = str(payload.get('quantity_unit') or (donation or {}).get('quantity_unit') or '').strip()
    food_name = str(payload.get('food_name') or (donation or {}).get('food_name') or '').strip()
    if not food_name:
        return jsonify({'error': 'Food name is required.'}), 400
    purpose = str(payload.get('purpose') or 'Community distribution').strip()
    request_item = {
        'id': f'request-{uuid.uuid4().hex}',
        'donation_id': donation_id,
        'ngo_id': user['id'],
        'requester_id': user['id'],
        'requested_quantity': quantity_value,
        'quantity_unit': quantity_unit,
        'food_name': food_name,
        'category': str(payload.get('category') or (donation or {}).get('category') or '').strip(),
        'priority': str(payload.get('priority') or '').strip().casefold() or None,
        'required_date': str(payload.get('required_date') or '').strip() or None,
        'required_time': str(payload.get('required_time') or '').strip() or None,
        'delivery_location': delivery_location,
        'multi_contribution': not bool(donation_id),
        'contributed_quantity': 0,
        'delivered_quantity': 0,
        'purpose': purpose,
        'status': 'pending',
        'created_at': utc_now(),
        'updated_at': utc_now(),
        'status_history': [{
            'status': 'pending',
            'changed_by': user['id'],
            'created_at': utc_now(),
        }],
    }
    data['donation_requests'].append(request_item)
    if donation:
        set_donation_status(data, donation, 'requested', user['id'], 'A donation request was submitted')
    data.setdefault('notifications', []).append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': donation['donor_id'] if donation else user['id'],
        'message': (
            f'{user["organization_name"] or user["full_name"]} requested {quantity_value} {quantity_unit} of {food_name}.'
            if donation else f'Your request for {quantity_value} {quantity_unit} of {food_name} was posted.'
        ),
        'type': 'request',
        'link': '/dashboard',
        'read_at': None,
        'created_at': utc_now(),
    })
    save_data(data)
    return jsonify({'request': request_item}), 201


@app.route('/api/donation-requests/<request_id>/contributions', methods=['POST'])
@serialize_request_contribution_updates
def create_request_contribution(request_id):
    user = current_user_from_auth()
    if not user or user.get('role') != 'donor':
        return jsonify({'error': 'Only donors can contribute food to a request.'}), 403

    payload = request.get_json(silent=True) or {}
    donation_id = str(payload.get('donation_id') or '').strip()
    try:
        quantity = float(payload.get('quantity'))
    except (TypeError, ValueError):
        return jsonify({'error': 'A valid contribution quantity is required.'}), 400
    if not math.isfinite(quantity) or quantity <= 0:
        return jsonify({'error': 'Contribution quantity must be greater than zero.'}), 400

    data = load_data()
    if expire_due_donations(data):
        save_data(data)
    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == request_id),
        None,
    )
    if not request_item or not request_item.get('multi_contribution'):
        return jsonify({'error': 'This request is not accepting donor contributions.'}), 404
    if request_item.get('status') in {'fulfilled', 'completed', 'rejected', 'cancelled'}:
        return jsonify({'error': 'This food request is no longer accepting contributions.'}), 409
    donation = next(
        (
            item for item in data.get('donations', [])
            if item.get('id') == donation_id and item.get('donor_id') == user['id']
        ),
        None,
    )
    if not donation:
        return jsonify({'error': 'Select one of your own food donations.'}), 404
    if not donation_is_requestable(data, donation):
        return jsonify({'error': 'This donation is not available for contribution.'}), 409
    if not donation_matches_food_request(donation, request_item):
        return jsonify({'error': 'Select a donation matching the requested food category or name and quantity unit.'}), 400

    requested_unit = str(request_item.get('quantity_unit') or '').strip().casefold()
    donation_unit = str(donation.get('quantity_unit') or '').strip().casefold()
    if not requested_unit or requested_unit != donation_unit:
        return jsonify({'error': 'Donation and request quantity units must match.'}), 400

    contributions = data.setdefault('request_contributions', [])
    if any(
        item.get('request_id') == request_id
        and item.get('donor_id') == user['id']
        and item.get('status') not in {'cancelled', 'rejected'}
        for item in contributions
    ):
        return jsonify({'error': 'You have already contributed to this request.'}), 409
    if donation.get('status') == 'cancelled':
        return jsonify({'error': 'Cancelled donations cannot be contributed to a request.'}), 409

    requested_quantity = float(request_item.get('requested_quantity', 0) or 0)
    contributed_quantity = sum(
        float(item.get('quantity', 0) or 0)
        for item in contributions
        if item.get('request_id') == request_id
        and item.get('status') not in {'cancelled', 'rejected'}
    )
    if quantity > requested_quantity - contributed_quantity:
        return jsonify({'error': 'Contribution exceeds the request’s remaining quantity.'}), 409

    remaining_donation = donation_available_quantity(data, donation)
    if quantity > remaining_donation:
        return jsonify({'error': 'Contribution exceeds the unallocated quantity of your donation.'}), 409

    contribution = {
        'id': f'request-contribution-{uuid.uuid4().hex[:10]}',
        'request_id': request_id,
        'donor_id': user['id'],
        'donation_id': donation_id,
        'quantity': quantity,
        'quantity_unit': request_item['quantity_unit'],
        'status': 'committed',
        'created_at': utc_now(),
        'updated_at': utc_now(),
    }
    contributions.append(contribution)
    for cancellation in data.get('donation_cancellations', []):
        if request_id not in cancellation.get('request_ids', []):
            continue
        replacement_ids = cancellation.setdefault('replacement_donation_ids', [])
        if donation_id not in replacement_ids:
            replacement_ids.append(donation_id)
        cancellation['reassignment_status'] = 'replacement_sourced'
        cancellation['updated_at'] = contribution['updated_at']
        cancellation.setdefault('status_history', []).append({
            'status': 'replacement_sourced',
            'created_at': contribution['updated_at'],
            'changed_by': user['id'],
        })
    request_item.setdefault('coordinating_ngo_id', None)
    update_multi_contribution_request_status(data, request_item, user['id'])
    request_item['updated_at'] = contribution['updated_at']
    recipient_id = request_item.get('requester_id', request_item.get('ngo_id'))
    data.setdefault('notifications', []).append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': recipient_id,
        'message': f'{user.get("full_name", "A donor")} contributed {quantity:g} {request_item["quantity_unit"]} of {request_item["food_name"]}.',
        'type': 'request',
        'link': '/dashboard',
        'read_at': None,
        'created_at': utc_now(),
    })
    save_data(data)
    return jsonify({'contribution': contribution}), 201


@app.route('/api/donation-requests/<request_id>/contributions/<contribution_id>/assign', methods=['POST'])
@serialize_request_contribution_updates
def assign_request_contribution(request_id, contribution_id):
    user = current_user_from_auth()
    if not user or user.get('role') != 'ngo':
        return jsonify({'error': 'Only NGOs can assign request deliveries.'}), 403

    payload = request.get_json(silent=True) or {}
    volunteer_id = str(payload.get('volunteer_id') or '').strip()
    if not volunteer_id:
        return jsonify({'error': 'Select an available volunteer.'}), 400

    data = load_data()
    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == request_id),
        None,
    )
    if not request_item or not request_item.get('multi_contribution'):
        return jsonify({'error': 'Food request not found.'}), 404
    coordinator_id = request_item.get('coordinating_ngo_id')
    if coordinator_id and coordinator_id != user['id']:
        return jsonify({'error': 'This food request is coordinated by another organization.'}), 403
    contribution = next(
        (
            item for item in data.get('request_contributions', [])
            if item.get('id') == contribution_id and item.get('request_id') == request_id
        ),
        None,
    )
    if not contribution:
        return jsonify({'error': 'Request contribution not found.'}), 404
    if contribution.get('status') != 'committed' or any(
        item.get('request_contribution_id') == contribution_id
        for item in data.get('delivery_tasks', [])
    ):
        return jsonify({'error': 'This contribution already has a delivery task.'}), 409

    donation = next(
        (item for item in data.get('donations', []) if item.get('id') == contribution.get('donation_id')),
        None,
    )
    volunteer = next(
        (
            item for item in data.get('profiles', [])
            if item.get('id') == volunteer_id and item.get('role') == 'volunteer'
        ),
        None,
    )
    if not donation:
        return jsonify({'error': 'The donor’s food listing is no longer available.'}), 404
    if expire_donation_if_due(data, donation):
        save_data(data)
        return jsonify({'error': 'This donation has expired and cannot be assigned for delivery.'}), 409
    if not donation_can_continue_distribution(data, donation):
        return jsonify({'error': 'This donation is outside its validity period or has no remaining food.'}), 409
    if not volunteer:
        return jsonify({'error': 'Available volunteer not found.'}), 404
    if any(
        item.get('volunteer_id') == volunteer_id
        and item.get('status') in {'assigned', 'accepted', 'picked_up', 'in_transit'}
        for item in data.get('delivery_tasks', [])
    ):
        return jsonify({'error': 'This volunteer already has an active delivery.'}), 409
    today = datetime.now(timezone.utc).date().isoformat()
    if any(
        item.get('volunteer_id') == volunteer_id
        and item.get('date') == today
        and item.get('status') == 'unavailable'
        for item in data.get('volunteer_availability', [])
    ):
        return jsonify({'error': 'This volunteer has marked themselves unavailable today.'}), 409

    assigned_at = utc_now()
    task = {
        'id': f'delivery-{uuid.uuid4().hex[:10]}',
        'request_id': request_id,
        'request_contribution_id': contribution_id,
        'donation_id': donation['id'],
        'ngo_id': user['id'],
        'volunteer_id': volunteer_id,
        'pickup_location': donation.get('pickup_location', ''),
        'pickup_instructions': donation.get('handling_instructions', ''),
        'dropoff_location': request_item.get('delivery_location') or '',
        'dropoff_instructions': request_item.get('purpose', ''),
        'quantity': contribution['quantity'],
        'quantity_unit': contribution['quantity_unit'],
        'status': 'assigned',
        'status_history': [{
            'status': 'assigned',
            'changed_by': user['id'],
            'created_at': assigned_at,
        }],
        'created_at': assigned_at,
        'updated_at': assigned_at,
    }
    data.setdefault('delivery_tasks', []).append(task)
    contribution['status'] = 'assigned'
    contribution['delivery_task_id'] = task['id']
    contribution['volunteer_id'] = volunteer_id
    contribution['updated_at'] = assigned_at
    request_item['coordinating_ngo_id'] = user['id']
    request_item['updated_at'] = assigned_at
    data.setdefault('notifications', []).extend([
        {
            'id': f'notify-{uuid.uuid4().hex[:8]}',
            'user_id': volunteer_id,
            'message': f'You have been assigned a {contribution["quantity"]:g} {contribution["quantity_unit"]} delivery for {request_item["food_name"]}.',
            'type': 'delivery',
            'link': '/dashboard',
            'read_at': None,
            'created_at': assigned_at,
        },
        {
            'id': f'notify-{uuid.uuid4().hex[:8]}',
            'user_id': request_item.get('requester_id', request_item.get('ngo_id')),
            'message': f'A volunteer was assigned to deliver a contribution for {request_item["food_name"]}.',
            'type': 'delivery',
            'link': '/dashboard',
            'read_at': None,
            'created_at': assigned_at,
        },
    ])
    save_data(data)
    return jsonify({'task': task}), 201


@app.route('/api/donation-requests/<request_id>', methods=['PATCH'])
@serialize_request_contribution_updates
def update_request(request_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    request_item = next((r for r in data['donation_requests'] if r['id'] == request_id), None)
    if not request_item:
        return jsonify({'error': 'Request not found.'}), 404

    payload = request.get_json(silent=True) or {}
    new_status = payload.get('status')
    donation = next((d for d in data['donations'] if d['id'] == request_item['donation_id']), None)

    if (
        user.get('role') == 'ngo'
        and request_item.get('multi_contribution')
        and new_status == 'approved'
        and request_item.get('status') in {'pending', 'partially_fulfilled'}
        and request_item.get('coordinating_ngo_id') in (None, user['id'])
    ):
        request_item['coordinating_ngo_id'] = user['id']
        request_item['updated_at'] = utc_now()
        save_data(data)
        return jsonify({'request': request_item})

    can_review_request = (
        user['role'] == 'donor'
        and donation
        and donation['donor_id'] == user['id']
        and request_item.get('status') == 'pending'
        and not request_item.get('coordinating_ngo_id')
    ) or (
        user['role'] == 'ngo'
        and donation
        and request_item.get('requester_id')
        and request_item.get('coordinating_ngo_id') in (None, user['id'])
        and (
            (request_item.get('status') == 'pending' and new_status in {'approved', 'rejected'})
            or (request_item.get('status') == 'approved' and new_status == 'approved')
        )
    )
    if can_review_request:
        if new_status not in {'approved', 'rejected'}:
            return jsonify({'error': 'Requests can only be approved or rejected.'}), 400

        if new_status == 'approved' and donation:
            if expire_donation_if_due(data, donation):
                save_data(data)
                return jsonify({'error': 'This donation has expired and the request cannot be accepted.'}), 409
            if not donation_can_continue_distribution(data, donation):
                return jsonify({'error': 'This donation is outside its validity period or has no remaining food.'}), 409

        previous_status = request_item.get('status')
        set_request_status(request_item, new_status, user['id'])
        if user['role'] == 'ngo' and new_status == 'approved':
            request_item['coordinating_ngo_id'] = user['id']
        recipient_id = request_item.get('requester_id', request_item.get('ngo_id'))

        if new_status == 'approved':
            set_donation_status(data, donation, 'accepted', user['id'], 'Donation request approved')
            notification = {
                'id': f'notify-{uuid.uuid4().hex}',
                'user_id': recipient_id,
                'message': (
                    'An organization is coordinating delivery for your approved request.'
                    if previous_status == 'approved' and user['role'] == 'ngo'
                    else 'Your food request was approved.'
                ),
                'type': 'delivery' if previous_status == 'approved' else 'approval',
                'link': '/dashboard',
                'read_at': None,
                'created_at': utc_now(),
            }
            data.setdefault('notifications', []).append(notification)
        elif new_status == 'rejected':
            sync_donation_request_status(
                data,
                donation,
                user['id'],
                'Donation request rejected',
            )
            data.setdefault('notifications', []).append({
                'id': f'notify-{uuid.uuid4().hex}',
                'user_id': recipient_id,
                'message': 'Your food request was rejected by the donor.',
                'type': 'rejection',
                'link': '/dashboard',
                'read_at': None,
                'created_at': utc_now(),
            })

        save_data(data)
        return jsonify({'request': request_item})

    if (
        user['role'] == 'requester'
        and request_item.get('requester_id', request_item.get('ngo_id')) == user['id']
        and new_status == 'cancelled'
    ):
        if request_item.get('status') not in {'pending', 'approved'}:
            return jsonify({'error': 'Only pending or approved requests can be cancelled.'}), 409
        if any(
            item.get('request_id') == request_id
            and item.get('status') not in {'cancelled', 'rejected'}
            for item in data.get('request_contributions', [])
        ):
            return jsonify({'error': 'A request with donor contributions cannot be cancelled.'}), 409
        if any(
            item.get('request_id') == request_id
            for item in data.get('delivery_tasks', [])
        ):
            return jsonify({'error': 'A request with delivery history cannot be cancelled.'}), 409
        set_request_status(request_item, 'cancelled', user['id'])
        if donation:
            sync_donation_request_status(
                data,
                donation,
                user['id'],
                'Donation request cancelled',
            )
        save_data(data)
        return jsonify({'request': request_item})

    return jsonify({'error': 'Action not allowed.'}), 403


@app.route('/api/donation-requests/<request_id>', methods=['DELETE'])
@serialize_request_contribution_updates
def delete_request(request_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user.get('role') != 'requester':
        return jsonify({'error': 'Only the requester can delete their food request.'}), 403

    data = load_data()
    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == request_id),
        None,
    )
    if not request_item:
        return jsonify({'error': 'Request not found.'}), 404
    if request_item.get('requester_id', request_item.get('ngo_id')) != user['id']:
        return jsonify({'error': 'You can only delete your own food requests.'}), 403
    if request_item.get('status') != 'pending':
        return jsonify({'error': 'Only pending requests without delivery activity can be deleted. Cancel an approved request instead.'}), 409

    contribution_ids = {
        item.get('id')
        for item in data.get('request_contributions', [])
        if item.get('request_id') == request_id
    }
    has_contributions = bool(contribution_ids)
    has_delivery_history = any(
        task.get('request_id') == request_id
        or task.get('request_contribution_id') in contribution_ids
        for task in data.get('delivery_tasks', [])
    )
    donation_already_accepted = (
        request_item.get('donation_id')
        and request_item.get('status') in {'approved', 'accepted'}
    )
    if has_contributions or has_delivery_history or donation_already_accepted:
        return jsonify({
            'error': 'This request has donor contributions, an accepted donation, or delivery history and cannot be deleted.',
        }), 409

    data['donation_requests'] = [
        item for item in data.get('donation_requests', [])
        if item.get('id') != request_id
    ]
    donation = next(
        (item for item in data.get('donations', []) if item.get('id') == request_item.get('donation_id')),
        None,
    )
    if donation:
        sync_donation_request_status(
            data,
            donation,
            user['id'],
            'A food request was deleted',
        )
    save_data(data)
    return jsonify({'message': 'Food request deleted.'})


@app.route('/api/delivery-tasks', methods=['GET'])
def list_delivery_tasks():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user['role'] not in {'volunteer', 'ngo', 'admin'}:
        return jsonify({'error': 'Only volunteers and NGOs can view delivery tasks.'}), 403

    data = load_data()
    tasks = data.get('delivery_tasks', [])
    if user['role'] == 'volunteer':
        donations_by_id = {
            donation.get('id'): donation for donation in data.get('donations', [])
        }
        tasks = [
            task for task in tasks
            if task.get('volunteer_id') == user['id']
            or (
                task.get('status') == 'open'
                and (
                    not delivery_task_donation_id(data, task)
                    or donation_can_continue_distribution(
                        data,
                        donations_by_id.get(delivery_task_donation_id(data, task), {}),
                    )
                )
            )
        ]
    elif user['role'] == 'ngo':
        tasks = [task for task in tasks if task.get('ngo_id') == user['id']]

    profiles_by_id = {profile.get('id'): profile for profile in data.get('profiles', [])}
    donations_by_id = {donation.get('id'): donation for donation in data.get('donations', [])}
    request_contributions_by_id = {
        item.get('id'): item for item in data.get('request_contributions', [])
    }
    feedback_by_task = {}
    for feedback in data.get('delivery_feedback', []):
        feedback_by_task.setdefault(feedback.get('task_id'), []).append(feedback)
    issues_by_task = {}
    for issue in data.get('delivery_issues', []):
        issues_by_task.setdefault(issue.get('task_id'), []).append(issue)
    for task in tasks:
        volunteer = profiles_by_id.get(task.get('volunteer_id'))
        task['volunteer_name'] = volunteer.get('full_name', '') if volunteer else ''
        donation = donations_by_id.get(task.get('donation_id'))
        need = next(
            (item for item in data.get('community_needs', []) if item.get('id') == task.get('community_need_id')),
            None,
        )
        contribution = next(
            (item for item in data.get('community_need_contributions', []) if item.get('id') == task.get('community_contribution_id')),
            None,
        )
        request_contribution = request_contributions_by_id.get(task.get('request_contribution_id'))
        request_donation = donations_by_id.get(request_contribution.get('donation_id')) if request_contribution else None
        image_donation = donation or request_donation
        task['food_name'] = (
            image_donation.get('food_name', '')
            if image_donation else need.get('category', '') if need else ''
        )
        task['category'] = (
            image_donation.get('category', '')
            if image_donation else need.get('category', '') if need else ''
        )
        task['image_url'] = image_donation.get('image_url', '') if image_donation else ''
        task['image_source'] = image_donation.get('image_source', '') if image_donation else ''
        task['available_until'] = image_donation.get('available_until', '') if image_donation else ''
        task['pickup_available_until'] = image_donation.get('pickup_available_until', '') if image_donation else ''
        task['quantity'] = (
            request_contribution.get('quantity', '')
            if request_contribution
            else donation.get('quantity', '') if donation
            else contribution.get('quantity', '') if contribution else ''
        )
        task['quantity_unit'] = (
            request_contribution.get('quantity_unit', '')
            if request_contribution
            else donation.get('quantity_unit', '') if donation
            else 'servings' if contribution else ''
        )
        task_feedback = feedback_by_task.get(task.get('id'), [])
        task_issues = issues_by_task.get(task.get('id'), [])
        if user.get('role') in {'volunteer', 'ngo'}:
            task_feedback = [
                {key: value for key, value in item.items() if key not in {'author_id', 'author_name', 'receiver_id'}}
                for item in task_feedback
            ]
            task_issues = [
                {key: value for key, value in item.items() if key not in {'receiver_id', 'receiver_name'}}
                for item in task_issues
            ]
        task['feedback'] = task_feedback
        task['issues'] = task_issues
        request_item = next(
            (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
            None,
        )
        if user.get('role') == 'ngo' and request_item:
            receiver = profiles_by_id.get(request_item.get('requester_id', request_item.get('ngo_id')), {})
            task['receiver_name'] = receiver.get('organization_name') or receiver.get('full_name', 'Food receiver')
    return jsonify({'tasks': tasks})


@app.route('/api/delivery-tasks', methods=['POST'])
@serialize_request_contribution_updates
def create_delivery_task():
    user = current_user_from_auth()
    if not user or user['role'] != 'ngo':
        return jsonify({'error': 'Only NGOs can create delivery tasks.'}), 403

    payload = request.get_json(silent=True) or {}
    request_id = str(payload.get('request_id') or '').strip()
    if not request_id:
        return jsonify({'error': 'An approved request is required.'}), 400

    data = load_data()
    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == request_id),
        None,
    )
    if not request_item:
        return jsonify({'error': 'Food request not found.'}), 404
    if request_item.get('status') != 'approved':
        return jsonify({'error': 'A delivery task can only be created for an approved request.'}), 400
    if request_item.get('requester_id') and request_item.get('coordinating_ngo_id') != user['id']:
        return jsonify({'error': 'Coordinate this approved request before creating its delivery task.'}), 403
    if not request_item.get('requester_id') and request_item.get('ngo_id') != user['id']:
        return jsonify({'error': 'This request is not part of your organization’s distribution work.'}), 403
    saved_delivery_location = str(request_item.get('delivery_location') or '').strip()
    if request_item.get('requester_id'):
        if not saved_delivery_location:
            return jsonify({'error': 'The requester must provide a delivery location before a delivery task can be created.'}), 400
        dropoff_location = saved_delivery_location
    else:
        dropoff_location = str(payload.get('dropoff_location') or '').strip()
        if not dropoff_location:
            return jsonify({'error': 'A drop-off location is required for this request.'}), 400

    task_deadline = delivery_task_deadline(data, {
        'request_id': request_id,
        'donation_id': request_item.get('donation_id'),
    })
    if task_deadline is not None and task_deadline <= datetime.now().astimezone():
        return jsonify({'error': 'The scheduled delivery deadline has passed; a delivery task cannot be created.'}), 409

    donation = next(
        (item for item in data.get('donations', []) if item.get('id') == request_item.get('donation_id')),
        None,
    )
    if not donation:
        return jsonify({'error': 'The donation for this request no longer exists.'}), 404
    if expire_donation_if_due(data, donation):
        save_data(data)
        return jsonify({'error': 'Expired donations cannot be assigned to a delivery task.'}), 409
    if not donation_can_continue_distribution(data, donation):
        return jsonify({'error': 'This donation is outside its validity period or has no remaining food.'}), 409
    if any(
        task.get('request_id') == request_id and task.get('status') != 'delivered'
        for task in data.get('delivery_tasks', [])
    ):
        return jsonify({'error': 'An active delivery task already exists for this request.'}), 409

    task = {
        'id': f'delivery-{uuid.uuid4().hex[:10]}',
        'request_id': request_id,
        'donation_id': donation['id'],
        'ngo_id': user['id'],
        'volunteer_id': None,
        'pickup_location': donation.get('pickup_location', ''),
        'pickup_instructions': donation.get('handling_instructions', ''),
        'dropoff_location': dropoff_location,
        'dropoff_instructions': str(payload.get('dropoff_instructions') or '').strip(),
        'status': 'open',
        'status_history': [{
            'status': 'open',
            'changed_by': user['id'],
            'created_at': utc_now(),
        }],
        'created_at': utc_now(),
        'updated_at': utc_now(),
    }
    data.setdefault('delivery_tasks', []).append(task)
    data.setdefault('notifications', []).append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': request_item.get('requester_id', request_item.get('ngo_id')),
        'message': f'A delivery task is being coordinated for {donation.get("food_name", "your food request")}.',
        'type': 'delivery',
        'link': '/dashboard',
        'read_at': None,
        'created_at': utc_now(),
    })
    save_data(data)
    return jsonify({'task': task}), 201


@app.route('/api/delivery-tasks/<task_id>/accept', methods=['POST'])
@serialize_request_contribution_updates
def accept_delivery_task(task_id):
    user = current_user_from_auth()
    if not user or user['role'] != 'volunteer':
        return jsonify({'error': 'Only volunteers can accept delivery tasks.'}), 403

    data = load_data()
    if expire_due_donations(data):
        save_data(data)
    task = next(
        (item for item in data.get('delivery_tasks', []) if item.get('id') == task_id),
        None,
    )
    if not task:
        return jsonify({'error': 'Delivery task not found.'}), 404
    donation_id = delivery_task_donation_id(data, task)
    donation = next(
        (item for item in data.get('donations', []) if item.get('id') == donation_id),
        None,
    )
    if donation and expire_donation_if_due(data, donation):
        save_data(data)
        return jsonify({'error': 'This delivery task is linked to expired food and cannot be accepted.'}), 409
    if donation and not donation_can_continue_distribution(data, donation):
        return jsonify({'error': 'This delivery task is outside the food validity period.'}), 409
    if task.get('status') == 'cancelled':
        return jsonify({'error': 'This delivery task was cancelled and cannot be accepted.'}), 409
    can_accept_open_task = task.get('status') == 'open' and not task.get('volunteer_id')
    can_accept_assigned_task = task.get('status') == 'assigned' and task.get('volunteer_id') == user['id']
    if not (can_accept_open_task or can_accept_assigned_task):
        return jsonify({'error': 'This delivery task has already been accepted.'}), 409

    task['volunteer_id'] = user['id']
    task['volunteer_name'] = user.get('full_name', '')
    task['status'] = 'assigned' if can_accept_open_task else 'accepted'
    task['updated_at'] = utc_now()
    task.setdefault('status_history', []).append({
        'status': task['status'],
        'changed_by': user['id'],
        'created_at': task['updated_at'],
    })
    data.setdefault('notifications', []).append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': task['ngo_id'],
        'message': (
            f'{user["full_name"]} was assigned a delivery task.'
            if can_accept_open_task
            else f'{user["full_name"]} accepted a delivery task.'
        ),
        'type': 'delivery',
        'link': '/dashboard',
        'read_at': None,
        'created_at': utc_now(),
    })
    if task.get('community_need_id'):
        need = next(
            (item for item in data.get('community_needs', []) if item.get('id') == task['community_need_id']),
            None,
        )
        if need:
            data.setdefault('notifications', []).append({
                'id': f'notify-{uuid.uuid4().hex[:8]}',
                'user_id': need['ngo_id'],
                'message': f'{user["full_name"]} accepted a community food need delivery.',
                'type': 'community_need',
                'link': '/dashboard',
                'read_at': None,
                'created_at': utc_now(),
            })
    save_data(data)
    return jsonify({'task': task})


@app.route('/api/delivery-tasks/<task_id>', methods=['PATCH'])
@serialize_request_contribution_updates
def update_delivery_task(task_id):
    user = current_user_from_auth()
    if not user or user['role'] != 'volunteer':
        return jsonify({'error': 'Only volunteers can update delivery status.'}), 403

    payload = request.get_json(silent=True) or {}
    next_status = payload.get('status')
    transitions = {
        'accepted': 'picked_up',
        'picked_up': 'in_transit',
        'in_transit': 'delivered',
    }
    data = load_data()
    task = next(
        (item for item in data.get('delivery_tasks', []) if item.get('id') == task_id),
        None,
    )
    if not task:
        return jsonify({'error': 'Delivery task not found.'}), 404
    if task.get('volunteer_id') != user['id']:
        return jsonify({'error': 'You can only update your own delivery tasks.'}), 403
    if task.get('status') == 'cancelled':
        return jsonify({'error': 'This delivery task was cancelled and cannot be advanced.'}), 409
    donation = next(
        (item for item in data.get('donations', []) if item.get('id') == delivery_task_donation_id(data, task)),
        None,
    )
    if donation and expire_donation_if_due(data, donation):
        save_data(data)
        return jsonify({'error': 'This delivery task is linked to expired food and cannot be advanced.'}), 409
    if donation and not donation_can_continue_distribution(data, donation):
        return jsonify({'error': 'This delivery task is outside the food validity period.'}), 409
    if transitions.get(task.get('status')) != next_status:
        return jsonify({'error': 'Delivery status must advance one step at a time.'}), 400

    task['status'] = next_status
    task['updated_at'] = utc_now()
    task.setdefault('status_history', []).append({
        'status': next_status,
        'changed_by': user['id'],
        'created_at': task['updated_at'],
    })
    if next_status == 'delivered':
        request_item = next(
            (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
            None,
        ) if task.get('request_id') else None
        request_contribution = next(
            (
                item for item in data.get('request_contributions', [])
                if item.get('id') == task.get('request_contribution_id')
            ),
            None,
        ) if task.get('request_contribution_id') else None
        if request_item and not request_item.get('multi_contribution'):
            requested_quantity = float(request_item.get('requested_quantity', 0) or 0)
            delivered_quantity = request_delivered_quantity(data, request_item)
            request_status = (
                'fulfilled'
                if requested_quantity > 0 and delivered_quantity >= requested_quantity
                else 'partially_fulfilled' if delivered_quantity > 0 else 'pending'
            )
            set_request_status(request_item, request_status, user['id'])
        if request_contribution:
            request_contribution['status'] = 'delivered'
            request_contribution['delivered_at'] = task['updated_at']
            request_contribution['updated_at'] = task['updated_at']
            if request_item:
                update_multi_contribution_request_status(data, request_item, user['id'])
                request_item['delivered_quantity'] = request_delivered_quantity(data, request_item)
                request_item['updated_at'] = task['updated_at']
        if request_item:
            for cancellation in data.get('donation_cancellations', []):
                if request_item.get('id') not in cancellation.get('request_ids', []):
                    continue
                next_reassignment_status = (
                    'resolved' if request_item.get('status') in {'fulfilled', 'completed'}
                    else 'replacement_sourced'
                )
                if cancellation.get('reassignment_status') != next_reassignment_status:
                    cancellation['reassignment_status'] = next_reassignment_status
                    cancellation['updated_at'] = task['updated_at']
                    cancellation.setdefault('status_history', []).append({
                        'status': next_reassignment_status,
                        'created_at': task['updated_at'],
                        'changed_by': user['id'],
                    })
        donation = next(
            (
                item for item in data.get('donations', [])
                if item.get('id') == delivery_task_donation_id(data, task)
            ),
            None,
        )
        other_open_requests = any(
            item.get('donation_id') == task.get('donation_id')
            and item.get('status') in {'pending', 'approved', 'accepted'}
            for item in data.get('donation_requests', [])
        )
        other_undelivered_contributions = any(
            item.get('donation_id') == task.get('donation_id')
            and item.get('status') not in {'delivered', 'cancelled', 'rejected'}
            for item in data.get('request_contributions', [])
        )
        if donation:
            expire_donation_if_due(data, donation)
            if not other_open_requests and not other_undelivered_contributions:
                sync_donation_request_status(
                    data,
                    donation,
                    user['id'],
                    'A food delivery completed; some original quantity remains',
                )
        if donation:
            create_donor_certificates(data, donation.get('donor_id'))
        if request_item and not request_item.get('multi_contribution'):
            data.setdefault('notifications', []).append({
                'id': f'notify-{uuid.uuid4().hex[:8]}',
                'user_id': request_item.get('requester_id', request_item.get('ngo_id')),
                'message': 'Your food request has been fulfilled.',
                'type': 'delivery',
                'link': f'/delivery-feedback/{task["id"]}',
                'read_at': None,
                'created_at': utc_now(),
            })
        elif request_item and request_contribution:
            recipient_id = request_item.get('requester_id', request_item.get('ngo_id'))
            data.setdefault('notifications', []).append({
                'id': f'notify-{uuid.uuid4().hex[:8]}',
                'user_id': recipient_id,
                'message': (
                    f'{request_contribution["quantity"]:g} {request_contribution["quantity_unit"]} of '
                    f'{request_item["food_name"]} was delivered. Request status: {request_item["status"]}.'
                ),
                'type': 'delivery',
                'link': '/dashboard',
                'read_at': None,
                'created_at': utc_now(),
            })
        if task.get('community_need_id') and task.get('community_contribution_id'):
            contribution = next(
                (
                    item for item in data.get('community_need_contributions', [])
                    if item.get('id') == task['community_contribution_id']
                ),
                None,
            )
            need = next(
                (item for item in data.get('community_needs', []) if item.get('id') == task['community_need_id']),
                None,
            )
            if contribution and need:
                contribution['status'] = 'delivered'
                contribution['delivered_at'] = task['updated_at']
                need_tasks = [
                    item for item in data.get('delivery_tasks', [])
                    if item.get('community_need_id') == need['id']
                ]
                delivered_quantity = sum(
                    float(item.get('quantity', 0) or 0)
                    for item in data.get('community_need_contributions', [])
                    if item.get('need_id') == need['id'] and item.get('status') == 'delivered'
                )
                need['status'] = (
                    'fulfilled'
                    if delivered_quantity >= float(need.get('required_quantity', 0) or 0)
                    else 'pending_delivery' if need_tasks else 'partial'
                )
                need['delivered_quantity'] = delivered_quantity
                need['updated_at'] = task['updated_at']
                data.setdefault('notifications', []).append({
                    'id': f'notify-{uuid.uuid4().hex[:8]}',
                    'user_id': need['ngo_id'],
                    'message': (
                        f'Community need for {need.get("category", "food")} was fulfilled after delivery.'
                        if need['status'] == 'fulfilled'
                        else f'A delivery for {need.get("category", "a community food need")} was completed.'
                    ),
                    'type': 'community_need',
                    'link': '/dashboard',
                    'read_at': None,
                    'created_at': utc_now(),
                })
    elif task.get('community_need_id'):
        need = next(
            (item for item in data.get('community_needs', []) if item.get('id') == task['community_need_id']),
            None,
        )
        if need:
            data.setdefault('notifications', []).append({
                'id': f'notify-{uuid.uuid4().hex[:8]}',
                'user_id': need['ngo_id'],
                'message': f'Community need delivery status changed to {next_status.replace("_", " ")}.',
                'type': 'community_need',
                'link': '/dashboard',
                'read_at': None,
                'created_at': utc_now(),
            })
        data.setdefault('notifications', []).append({
            'id': f'notify-{uuid.uuid4().hex[:8]}',
            'user_id': task['ngo_id'],
            'message': f'{user["full_name"]} marked a delivery as delivered.',
            'type': 'delivery',
            'link': f'/delivery-feedback/{task["id"]}',
            'read_at': None,
            'created_at': utc_now(),
        })

    save_data(data)
    return jsonify({'task': task})


@app.route('/api/delivery-tasks/<task_id>/route', methods=['PATCH'])
def update_delivery_route(task_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user.get('role') not in {'volunteer', 'ngo'}:
        return jsonify({'error': 'Only the assigned volunteer or coordinating NGO can edit delivery addresses.'}), 403

    payload = request.get_json(silent=True) or {}
    pickup_location = str(payload.get('pickup_location') or '').strip()
    dropoff_location = str(payload.get('dropoff_location') or '').strip()
    if not pickup_location or not dropoff_location:
        return jsonify({'error': 'Pickup and drop-off addresses are required.'}), 400

    data = load_data()
    task = next((item for item in data.get('delivery_tasks', []) if item.get('id') == task_id), None)
    if not task:
        return jsonify({'error': 'Delivery task not found.'}), 404
    is_assigned_volunteer = user.get('role') == 'volunteer' and task.get('volunteer_id') == user['id']
    is_coordinating_ngo = user.get('role') == 'ngo' and task.get('ngo_id') == user['id']
    if not (is_assigned_volunteer or is_coordinating_ngo):
        return jsonify({'error': 'You can only edit addresses for deliveries assigned to you or your organization.'}), 403

    task['pickup_location'] = pickup_location
    task['dropoff_location'] = dropoff_location
    task['updated_at'] = utc_now()
    task.setdefault('route_history', []).append({
        'pickup_location': pickup_location,
        'dropoff_location': dropoff_location,
        'changed_by': user['id'],
        'created_at': task['updated_at'],
    })
    save_data(data)
    return jsonify({'task': task})


@app.route('/api/donor/certificates', methods=['GET'])
@serialize_request_contribution_updates
def donor_certificates():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user.get('role') != 'donor':
        return jsonify({'error': 'Only donors can view donation certificates.'}), 403

    data = load_data()
    created_certificates = create_donor_certificates(data, user['id'])
    if created_certificates['changed']:
        save_data(data)
    completed_count = len(donor_completed_donations(data, user['id']))
    donor_certificates = [
        item for item in data.get('donation_certificates', [])
        if item.get('donor_id') == user['id']
        and (
            item.get('certificate_type') == 'donation'
            or (item.get('donation_id') and not item.get('milestone'))
        )
    ]
    milestone_targets = {
        milestone['key']: target
        for target, milestone in DONATION_MILESTONES.items()
    }
    milestone_certificates = [
        item for item in data.get('donation_certificates', [])
        if item.get('donor_id') == user['id']
        and item.get('certificate_type') == 'milestone'
        and item.get('milestone') in milestone_targets
        and completed_count >= milestone_targets[item['milestone']]
        and int(item.get('completed_donations', item.get('completed_deliveries', 0)) or 0)
        == milestone_targets[item['milestone']]
    ]
    donor_certificates.sort(key=lambda item: (item.get('delivery_date') or '', item.get('donation_id') or ''))
    milestone_certificates.sort(key=lambda item: item.get('completed_donations', 0))
    milestone_progress = [
        {
            'key': milestone['key'],
            'title': milestone['title'],
            'required_donations': target,
            'completed_donations': min(completed_count, target),
            'remaining_donations': max(0, target - completed_count),
            'progress_percent': min(100, completed_count / target * 100),
        }
        for target, milestone in DONATION_MILESTONES.items()
    ]
    next_milestone = next(
        (milestone for milestone in milestone_progress if milestone['remaining_donations'] > 0),
        None,
    )
    return jsonify({
        'completed_donations': completed_count,
        'completed_deliveries': completed_count,
        'donation_certificates': donor_certificates,
        'milestone_certificates': milestone_certificates,
        'milestones': milestone_progress,
        'next_milestone': next_milestone,
    })


@app.route('/api/certificates/download', methods=['POST'])
def download_certificate_pdf():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    payload = request.get_json(silent=True) if request.is_json else None
    payload = payload or request.form
    certificate_id = str(payload.get('certificate_id') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', certificate_id):
        return jsonify({'error': 'A valid certificate ID is required.'}), 400

    if user.get('role') == 'donor':
        data = load_data()
        owns_certificate = any(
            item.get('donor_id') == user.get('id')
            and item.get('certificate_id') == certificate_id
            for item in data.get('donation_certificates', [])
        )
        if not owns_certificate:
            return jsonify({'error': 'Certificate not found for this donor.'}), 404
    elif user.get('role') == 'volunteer':
        if not certificate_id.startswith('SFDRS-VOL-') or payload is None:
            return jsonify({'error': 'Certificate not found for this volunteer.'}), 404
    else:
        return jsonify({'error': 'Only donors and volunteers can download certificates.'}), 403

    if request.is_json:
        if user.get('role') != 'volunteer':
            return jsonify({'error': 'Only volunteers can generate certificates through this endpoint.'}), 403
        recipient_name = str(payload.get('recipient_name') or user.get('full_name') or '').strip()
        issue_date = str(payload.get('issue_date') or '').strip()
        delivery_count = payload.get('completed_deliveries')
        if (
            not recipient_name
            or len(recipient_name) > 300
            or not issue_date
            or len(issue_date) > 100
            or type(delivery_count) is not int
            or delivery_count < 0
        ):
            return jsonify({'error': 'Volunteer certificate details are incomplete or invalid.'}), 400
        pdf_content = create_volunteer_certificate_pdf(
            recipient_name,
            delivery_count,
            issue_date,
            certificate_id,
        )
    else:
        certificate_file = request.files.get('certificate_pdf')
        if not certificate_file:
            return jsonify({'error': 'A generated PDF certificate is required.'}), 400
        pdf_content = certificate_file.stream.read(MAX_UPLOAD_SIZE_BYTES + 1)
        if len(pdf_content) > MAX_UPLOAD_SIZE_BYTES:
            return jsonify({'error': 'The certificate PDF exceeds the maximum allowed size.'}), 413
        if not pdf_content.startswith(b'%PDF-') or not pdf_content.rstrip().endswith(b'%%EOF'):
            return jsonify({'error': 'The uploaded certificate is not a valid PDF file.'}), 400

    if len(pdf_content) > MAX_UPLOAD_SIZE_BYTES:
        return jsonify({'error': 'The generated certificate PDF exceeds the maximum allowed size.'}), 413

    return send_file(
        io.BytesIO(pdf_content),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'{certificate_id}.pdf',
        max_age=0,
    )


def create_volunteer_certificate_pdf(recipient_name, completed_deliveries, issue_date, certificate_id):
    page_width, page_height = landscape(A4)
    buffer = io.BytesIO()
    document = canvas.Canvas(buffer, pagesize=(page_width, page_height), pageCompression=1)
    green = colors.HexColor('#164638')
    gold = colors.HexColor('#b79a5c')
    paper = colors.HexColor('#fbf9f1')
    muted = colors.HexColor('#60685f')

    document.setFillColor(paper)
    document.rect(0, 0, page_width, page_height, fill=1, stroke=0)
    document.setStrokeColor(green)
    document.setLineWidth(9)
    document.rect(13, 13, page_width - 26, page_height - 26, fill=0, stroke=1)
    document.setStrokeColor(gold)
    document.setLineWidth(2)
    document.rect(24, 24, page_width - 48, page_height - 48, fill=0, stroke=1)
    document.setStrokeColor(green)
    document.setLineWidth(1)
    document.rect(32, 32, page_width - 64, page_height - 64, fill=0, stroke=1)

    for x, y, horizontal, vertical in (
        (42, page_height - 42, 1, -1),
        (page_width - 42, page_height - 42, -1, -1),
        (42, 42, 1, 1),
        (page_width - 42, 42, -1, 1),
    ):
        document.setStrokeColor(gold)
        document.setLineWidth(2)
        document.line(x, y, x + 30 * horizontal, y)
        document.line(x, y, x, y + 30 * vertical)

    center_x = page_width / 2
    emblem_y = page_height - 64
    document.setFillColor(green)
    document.circle(center_x, emblem_y, 24, fill=1, stroke=0)
    document.setStrokeColor(gold)
    document.setLineWidth(1.2)
    document.circle(center_x, emblem_y, 20, fill=0, stroke=1)
    document.setStrokeColor(colors.HexColor('#f7efd9'))
    document.setLineWidth(1.6)
    emblem_scale = 30.3 / 64

    def emblem_point(x, y):
        return center_x + (x - 32) * emblem_scale, emblem_y + (32 - y) * emblem_scale

    plate = document.beginPath()
    plate.moveTo(*emblem_point(12, 38))
    plate.curveTo(*emblem_point(21, 30), *emblem_point(43, 30), *emblem_point(52, 38))
    plate.lineTo(*emblem_point(52, 48))
    plate.lineTo(*emblem_point(12, 48))
    plate.close()
    document.setFillColor(colors.HexColor('#d8bd7e'))
    document.drawPath(plate, fill=1, stroke=0)

    leaves = document.beginPath()
    leaves.moveTo(*emblem_point(16, 37))
    leaves.curveTo(*emblem_point(25, 31), *emblem_point(39, 31), *emblem_point(48, 37))
    leaves.moveTo(*emblem_point(24, 32))
    leaves.curveTo(*emblem_point(18, 24), *emblem_point(20, 16), *emblem_point(26, 12))
    leaves.curveTo(*emblem_point(32, 18), *emblem_point(33, 24), *emblem_point(30, 31))
    leaves.moveTo(*emblem_point(33, 31))
    leaves.curveTo(*emblem_point(31, 20), *emblem_point(35, 12), *emblem_point(42, 9))
    leaves.curveTo(*emblem_point(46, 17), *emblem_point(44, 24), *emblem_point(39, 32))
    leaves.moveTo(*emblem_point(41, 34))
    leaves.curveTo(*emblem_point(43, 26), *emblem_point(49, 22), *emblem_point(56, 23))
    leaves.curveTo(*emblem_point(56, 30), *emblem_point(52, 35), *emblem_point(44, 38))
    leaves.moveTo(*emblem_point(20, 53))
    leaves.lineTo(*emblem_point(44, 53))
    document.setStrokeColor(colors.HexColor('#f7efd9'))
    document.setLineWidth(1.2)
    document.setLineCap(1)
    document.drawPath(leaves, fill=0, stroke=1)

    def draw_paragraph(text, y_center, width, font, size, color, alignment=TA_CENTER, leading=None):
        style = ParagraphStyle(
            name='certificate-text',
            fontName=font,
            fontSize=size,
            leading=leading or size * 1.25,
            textColor=color,
            alignment=alignment,
        )
        paragraph = Paragraph(escape(str(text)), style)
        _, height = paragraph.wrap(width, page_height)
        paragraph.drawOn(document, center_x - width / 2, y_center - height / 2)

    draw_paragraph('SMART FOOD DONATION AND REDISTRIBUTION SYSTEM', page_height - 111, page_width - 130, 'Helvetica-Bold', 9, colors.HexColor('#806938'))
    draw_paragraph('Certificate of Appreciation', page_height - 151, page_width - 120, 'Times-Roman', 30, green)
    document.setStrokeColor(gold)
    document.setLineWidth(1)
    document.line(page_width * .27, page_height - 169, page_width * .73, page_height - 169)

    draw_paragraph('Presented with gratitude to', page_height - 202, page_width - 140, 'Helvetica', 11, muted)
    draw_paragraph(recipient_name, page_height - 245, page_width - 150, 'Times-Bold', 36, green, leading=42)
    draw_paragraph('For dedicated service to community food redistribution', page_height - 286, page_width - 140, 'Times-Italic', 13, colors.HexColor('#344b3f'))
    draw_paragraph('Successfully completed deliveries', page_height - 313, page_width - 140, 'Helvetica-Bold', 9, colors.HexColor('#856d3a'))
    draw_paragraph(f'{completed_deliveries:,}', page_height - 340, page_width - 140, 'Helvetica-Bold', 20, green)
    draw_paragraph('Community Food Redistribution Project', page_height - 365, page_width - 140, 'Helvetica', 10, muted)
    draw_paragraph(
        'With gratitude for carrying nourishing food to neighbors and strengthening our community through dependable service.',
        page_height - 395,
        page_width - 210,
        'Times-Roman',
        10,
        colors.HexColor('#4f5b51'),
        leading=14,
    )

    footer_y = 69
    signature_x = 185
    document.setStrokeColor(colors.HexColor('#697368'))
    document.setLineWidth(0.8)
    document.line(signature_x - 85, footer_y + 19, signature_x + 85, footer_y + 19)
    document.setFillColor(colors.HexColor('#344b3f'))
    document.setFont('Times-Italic', 11)
    document.drawCentredString(signature_x, footer_y + 5, 'Project Coordinator')
    document.setFillColor(colors.HexColor('#777b71'))
    document.setFont('Helvetica-Bold', 7)
    document.drawCentredString(signature_x, footer_y - 8, 'AUTHORIZED SIGNATURE')

    document.setFillColor(colors.HexColor('#667067'))
    document.setFont('Helvetica', 7)
    document.drawRightString(page_width - 54, footer_y + 13, f'ACHIEVEMENT DATE  ·  {issue_date}')
    document.drawRightString(page_width - 54, footer_y, f'ISSUE DATE  ·  {issue_date}')
    document.drawRightString(page_width - 54, footer_y - 13, f'CERTIFICATE ID  ·  {certificate_id}')

    document.showPage()
    document.save()
    buffer.seek(0)
    return buffer.read()


@app.route('/api/volunteer/leaderboard', methods=['GET'])
def volunteer_leaderboard():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user.get('role') != 'volunteer':
        return jsonify({'error': 'Only volunteers can view the volunteer leaderboard.'}), 403

    data = load_data()
    counts = {}
    for task in data.get('delivery_tasks', []):
        volunteer_id = task.get('volunteer_id')
        if volunteer_id and task.get('status') == 'delivered':
            counts[volunteer_id] = counts.get(volunteer_id, 0) + 1

    entries = [
        {'volunteer_id': profile['id'], 'name': profile.get('full_name', ''), 'completed_deliveries': counts.get(profile['id'], 0)}
        for profile in data.get('profiles', [])
        if profile.get('role') == 'volunteer' and counts.get(profile['id'], 0) > 0
    ]
    entries.sort(key=lambda item: (-item['completed_deliveries'], item['name'].casefold(), item['volunteer_id']))
    leaderboard = []
    previous_count = None
    rank = 0
    for position, entry in enumerate(entries, start=1):
        if entry['completed_deliveries'] != previous_count:
            rank = position
            previous_count = entry['completed_deliveries']
        leaderboard.append({**entry, 'rank': rank})
    return jsonify({'leaderboard': leaderboard})


@app.route('/api/volunteer/availability', methods=['GET', 'POST'])
def volunteer_availability():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    if request.method == 'GET':
        if user.get('role') not in {'volunteer', 'ngo'}:
            return jsonify({'error': 'Only volunteers and NGOs can view volunteer availability.'}), 403
        data = load_auth_data()
        profiles_by_id = {
            profile.get('id'): profile
            for profile in data.get('profiles', [])
            if profile.get('id')
        }
        entries = data.get('volunteer_availability', [])
        visible_entries = (
            [entry for entry in entries if entry.get('volunteer_id') == user['id']]
            if user.get('role') == 'volunteer'
            else [
                {
                    **entry,
                    'volunteer_name': str(
                        profiles_by_id.get(entry.get('volunteer_id'), {}).get('full_name')
                        or 'Volunteer'
                    ),
                }
                for entry in entries
                if entry.get('volunteer_id') in profiles_by_id
            ]
        )
        visible_entries.sort(key=lambda entry: (
            entry.get('date', ''),
            str(entry.get('volunteer_name') or '').casefold(),
        ))
        return jsonify({'availability': visible_entries})

    if user.get('role') != 'volunteer':
        return jsonify({'error': 'Only volunteers can manage availability.'}), 403

    payload = request.get_json(silent=True) or {}
    date_value = str(payload.get('date') or '').strip()
    status = str(payload.get('status') or '').strip().lower()
    notes = str(payload.get('notes') or '').strip()
    try:
        datetime.strptime(date_value, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Availability date must use YYYY-MM-DD format.'}), 400
    if status not in {'available', 'unavailable'}:
        return jsonify({'error': 'Availability must be available or unavailable.'}), 400
    if len(notes) > 500:
        return jsonify({'error': 'Availability notes cannot exceed 500 characters.'}), 400

    with DATA_SAVE_LOCK:
        data = load_auth_data()
        entries = data.setdefault('volunteer_availability', [])
        entry = next(
            (
                item for item in entries
                if item.get('volunteer_id') == user['id'] and item.get('date') == date_value
            ),
            None,
        )
        created = entry is None
        if created:
            entry = {
                'id': f'availability-{uuid.uuid4().hex[:10]}',
                'volunteer_id': user['id'],
                'date': date_value,
                'created_at': utc_now(),
            }
            entries.append(entry)
        entry.update({
            'status': status,
            'notes': notes,
            'updated_at': utc_now(),
        })
        write_data_file_atomically(data)
    return jsonify({'availability': entry}), 201 if created else 200


@app.route('/api/volunteer/availability/<entry_id>', methods=['PATCH', 'DELETE'])
def update_volunteer_availability(entry_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if user.get('role') != 'volunteer':
        return jsonify({'error': 'Only volunteers can manage availability.'}), 403

    with DATA_SAVE_LOCK:
        data = load_auth_data()
        entries = data.setdefault('volunteer_availability', [])
        entry = next((item for item in entries if item.get('id') == entry_id), None)
        if not entry:
            return jsonify({'error': 'Availability entry not found.'}), 404
        if entry.get('volunteer_id') != user['id']:
            return jsonify({'error': 'You can only modify your own availability.'}), 403

        if request.method == 'DELETE':
            data['volunteer_availability'] = [
                item for item in entries if item.get('id') != entry_id
            ]
            write_data_file_atomically(data)
            return jsonify({'success': True, 'deleted_id': entry_id})

        payload = request.get_json(silent=True) or {}
        date_value = str(payload.get('date') or '').strip()
        status = str(payload.get('status') or '').strip().lower()
        notes = str(payload.get('notes', entry.get('notes', '')) or '').strip()
        try:
            datetime.strptime(date_value, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Availability date must use YYYY-MM-DD format.'}), 400
        if status not in {'available', 'unavailable'}:
            return jsonify({'error': 'Availability must be available or unavailable.'}), 400
        if len(notes) > 500:
            return jsonify({'error': 'Availability notes cannot exceed 500 characters.'}), 400

        existing_date_entry = next(
            (
                other for other in entries
                if other.get('volunteer_id') == user['id']
                and other.get('date') == date_value
                and other.get('id') != entry_id
            ),
            None,
        )
        if existing_date_entry:
            existing_date_entry.update({
                'status': status,
                'notes': notes,
                'updated_at': utc_now(),
            })
            data['volunteer_availability'] = [
                item for item in entries if item.get('id') != entry_id
            ]
            entry = existing_date_entry
        else:
            entry['date'] = date_value
            entry['status'] = status
            entry['notes'] = notes
            entry['updated_at'] = utc_now()
        write_data_file_atomically(data)
    return jsonify({'availability': entry})


def _feedback_permission(user, task, request_item):
    if user.get('role') == 'volunteer':
        return task.get('volunteer_id') == user.get('id')
    if user.get('role') == 'requester':
        return request_item and request_item.get('requester_id', request_item.get('ngo_id')) == user.get('id')
    if user.get('role') == 'ngo':
        return task.get('ngo_id') == user.get('id')
    return False


@app.route('/api/delivery-tasks/<task_id>/feedback', methods=['GET', 'POST'])
def delivery_task_feedback(task_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    data = load_data()
    task = next((item for item in data.get('delivery_tasks', []) if item.get('id') == task_id), None)
    if not task:
        return jsonify({'error': 'Delivery task not found.'}), 404
    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
        None,
    )
    if not _feedback_permission(user, task, request_item):
        return jsonify({'error': 'You are not authorized to view or submit feedback for this delivery.'}), 403
    if request.method == 'POST' and user.get('role') != 'requester':
        return jsonify({'error': 'Only the receiver who owns this delivery can submit feedback.'}), 403

    feedback_entries = data.get('delivery_feedback', [])
    if request.method == 'GET':
        if task.get('status') != 'delivered':
            return jsonify({'error': 'Feedback is available after the delivery is marked delivered.'}), 409
        if user.get('role') == 'volunteer':
            visible = [item for item in feedback_entries if item.get('task_id') == task_id]
            visible = [
                {key: value for key, value in item.items() if key not in {'author_id', 'author_name', 'receiver_id'}}
                for item in visible
            ]
            visible_issues = [
                {key: value for key, value in item.items() if key not in {'receiver_id', 'receiver_name'}}
                for item in data.get('delivery_issues', [])
                if item.get('task_id') == task_id
            ]
        elif user.get('role') == 'ngo':
            visible = [
                {key: value for key, value in item.items() if key not in {'author_id', 'author_name', 'receiver_id'}}
                for item in feedback_entries
                if item.get('task_id') == task_id
            ]
            visible_issues = [
                {key: value for key, value in item.items() if key not in {'receiver_id', 'receiver_name'}}
                for item in data.get('delivery_issues', [])
                if item.get('task_id') == task_id
            ]
        else:
            visible = [
                item for item in feedback_entries
                if item.get('task_id') == task_id and item.get('author_id') == user['id']
            ]
            visible_issues = [
                item for item in data.get('delivery_issues', [])
                if item.get('task_id') == task_id
                and (user.get('role') == 'ngo' or item.get('receiver_id') == user['id'])
            ]
        return jsonify({
            'task': task,
            'feedback': visible,
            'my_feedback': next((item for item in visible if item.get('author_id') == user['id']), None),
            'has_feedback': any(item.get('task_id') == task_id for item in feedback_entries),
            'issues': visible_issues,
        })

    if task.get('status') != 'delivered':
        return jsonify({'error': 'Feedback can only be submitted after delivery is marked delivered.'}), 409
    payload = request.get_json(silent=True) or {}
    try:
        rating = int(payload.get('rating'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Rating must be a whole number from 1 to 5.'}), 400
    food_condition = str(payload.get('food_condition_feedback') or payload.get('food_condition') or '').strip()
    delivery_experience = str(payload.get('delivery_experience_feedback') or payload.get('delivery_experience') or '').strip()
    comment = str(payload.get('comments') or payload.get('comment') or '').strip()
    appreciation = str(payload.get('appreciation_message') or '').strip()
    if rating not in range(1, 6):
        return jsonify({'error': 'Rating must be from 1 to 5.'}), 400
    if not appreciation:
        return jsonify({'error': 'An appreciation message is required.'}), 400
    if not food_condition and not delivery_experience and comment:
        delivery_experience = comment
    if not food_condition or not delivery_experience:
        return jsonify({'error': 'Food condition and delivery experience feedback are required.'}), 400
    if len(food_condition) > 2000 or len(delivery_experience) > 2000 or len(comment) > 2000 or len(appreciation) > 500:
        return jsonify({'error': 'Feedback fields must be 2000 characters or fewer and appreciation must be 500 characters or fewer.'}), 400

    with DELIVERY_FEEDBACK_LOCK:
        data = load_data()
        task = next((item for item in data.get('delivery_tasks', []) if item.get('id') == task_id), None)
        if not task:
            return jsonify({'error': 'Delivery task not found.'}), 404
        request_item = next(
            (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
            None,
        )
        if not _feedback_permission(user, task, request_item):
            return jsonify({'error': 'You are not authorized to submit feedback for this delivery.'}), 403
        if task.get('status') != 'delivered':
            return jsonify({'error': 'Feedback can only be submitted after delivery is marked delivered.'}), 409
        feedback_entries = data.get('delivery_feedback', [])
        if any(item.get('task_id') == task_id for item in feedback_entries):
            return jsonify({'error': 'Feedback has already been submitted for this delivery.'}), 409

        entry = {
            'id': f'feedback-{uuid.uuid4().hex[:10]}',
            'task_id': task_id,
            'delivery_id': task_id,
            'donation_id': delivery_task_donation_id(data, task),
            'request_id': task.get('request_id'),
            'volunteer_id': task.get('volunteer_id'),
            'author_id': user['id'],
            'receiver_id': request_item.get('requester_id', request_item.get('ngo_id')) if request_item else user['id'],
            'author_role': user['role'],
            'author_name': user.get('organization_name') if user.get('role') == 'ngo' else user.get('full_name', ''),
            'rating': rating,
            'food_condition_feedback': food_condition,
            'delivery_experience_feedback': delivery_experience,
            'comments': comment,
            'comment': comment,
            'appreciation_message': appreciation,
            'created_at': utc_now(),
            'updated_at': utc_now(),
        }
        data.setdefault('delivery_feedback', []).append(entry)
        donation = next(
            (item for item in data.get('donations', []) if item.get('id') == entry.get('donation_id')),
            None,
        )
        donor_id = donation.get('donor_id') if donation else None
        if donor_id and not any(
            item.get('user_id') == donor_id and item.get('feedback_id') == entry['id']
            for item in data.get('notifications', [])
        ):
            notify_user(
                data,
                donor_id,
                f'New feedback received for your donation {donation.get("food_name", "food")} ({donation.get("id")}).',
                notification_type='feedback',
                link=f'/dashboard/donor#donation-feedback-{donation.get("id")}',
            )
            data['notifications'][-1].update({
                'feedback_id': entry['id'],
                'donation_id': donation.get('id'),
            })
        ngo_id = task.get('ngo_id')
        if ngo_id and not any(
            item.get('user_id') == ngo_id and item.get('feedback_id') == entry['id']
            for item in data.get('notifications', [])
        ):
            notify_user(
                data,
                ngo_id,
                f'Delivery feedback is available for {donation.get("food_name", "a food donation") if donation else "a delivery"} (delivery {task_id}).',
                notification_type='feedback',
                link='/dashboard/ngo#delivery-feedback',
            )
            data['notifications'][-1].update({
                'feedback_id': entry['id'],
                'delivery_id': task_id,
                'donation_id': entry.get('donation_id'),
            })
        save_data(data)
    return jsonify({'feedback': entry}), 201


@app.route('/api/delivery-feedback/<feedback_id>', methods=['PATCH', 'DELETE'])
def update_delivery_feedback(feedback_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    data = load_data()
    entry = next(
        (item for item in data.get('delivery_feedback', []) if item.get('id') == feedback_id),
        None,
    )
    if not entry:
        return jsonify({'error': 'Feedback not found.'}), 404
    if entry.get('author_id') != user['id'] or user.get('role') != 'requester':
        return jsonify({'error': 'Only the receiver who submitted this feedback can modify it.'}), 403
    task = next((item for item in data.get('delivery_tasks', []) if item.get('id') == entry.get('task_id')), None)
    if not task or task.get('status') != 'delivered':
        return jsonify({'error': 'Feedback can only be modified for completed deliveries.'}), 409

    if request.method == 'DELETE':
        data['delivery_feedback'] = [
            item for item in data.get('delivery_feedback', [])
            if item.get('id') != feedback_id
        ]
        data['notifications'] = [
            item for item in data.get('notifications', [])
            if item.get('feedback_id') != feedback_id
        ]
        save_data(data)
        return jsonify({'success': True, 'deleted_id': feedback_id})

    payload = request.get_json(silent=True) or {}
    try:
        rating = int(payload.get('rating'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Rating must be a whole number from 1 to 5.'}), 400
    food_condition = str(payload.get('food_condition_feedback') or payload.get('food_condition') or entry.get('food_condition_feedback') or '').strip()
    delivery_experience = str(payload.get('delivery_experience_feedback') or payload.get('delivery_experience') or entry.get('delivery_experience_feedback') or '').strip()
    comment = str(payload.get('comments') or payload.get('comment') or '').strip()
    appreciation = str(payload.get('appreciation_message') or entry.get('appreciation_message') or '').strip()
    if rating not in range(1, 6):
        return jsonify({'error': 'Rating must be from 1 to 5.'}), 400
    if not food_condition and not delivery_experience and comment:
        delivery_experience = comment
    if not food_condition or not delivery_experience:
        return jsonify({'error': 'Food condition and delivery experience feedback are required.'}), 400
    if len(food_condition) > 2000 or len(delivery_experience) > 2000 or len(comment) > 2000 or len(appreciation) > 500:
        return jsonify({'error': 'Feedback fields must be 2000 characters or fewer and appreciation must be 500 characters or fewer.'}), 400
    entry['rating'] = rating
    entry['food_condition_feedback'] = food_condition
    entry['delivery_experience_feedback'] = delivery_experience
    entry['comments'] = comment
    entry['comment'] = comment
    entry['appreciation_message'] = appreciation
    entry['updated_at'] = utc_now()
    save_data(data)
    return jsonify({'feedback': entry})


@app.route('/api/delivery-issues', methods=['GET'])
def list_delivery_issues():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    data = load_data()
    visible_issues = []
    for issue in data.get('delivery_issues', []):
        task, request_item, donation = delivery_issue_context(data, issue)
        if delivery_issue_visible_to_user(user, issue, task, request_item, donation):
            visible_issues.append(serialize_delivery_issue(data, issue))
    visible_issues.sort(key=lambda item: item.get('created_at') or '', reverse=True)
    return jsonify({'issues': visible_issues})


@app.route('/api/delivery-tasks/<task_id>/issues', methods=['GET', 'POST'])
def delivery_task_issues(task_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    data = load_data()
    task = next((item for item in data.get('delivery_tasks', []) if item.get('id') == task_id), None)
    if not task:
        return jsonify({'error': 'Delivery task not found.'}), 404
    request_item = next(
        (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
        None,
    )
    if request.method == 'POST':
        if user.get('role') != 'requester' or not request_item or request_item.get('requester_id', request_item.get('ngo_id')) != user.get('id'):
            return jsonify({'error': 'Only the receiver who owns this delivery can report an issue.'}), 403
        if task.get('status') != 'delivered':
            return jsonify({'error': 'An issue can only be reported after the delivery is completed.'}), 409
        payload = request.get_json(silent=True) or {}
        description = str(payload.get('description') or '').strip()
        if not description:
            return jsonify({'error': 'Describe the delivery issue before submitting.'}), 400
        if len(description) > 2000:
            return jsonify({'error': 'Issue description must be 2000 characters or fewer.'}), 400

        with DELIVERY_ISSUE_LOCK:
            data = load_data()
            task = next((item for item in data.get('delivery_tasks', []) if item.get('id') == task_id), None)
            request_item = next(
                (item for item in data.get('donation_requests', []) if item.get('id') == task.get('request_id')),
                None,
            ) if task else None
            if not task or not request_item or request_item.get('requester_id', request_item.get('ngo_id')) != user.get('id'):
                return jsonify({'error': 'You are not authorized to report an issue for this delivery.'}), 403
            if task.get('status') != 'delivered':
                return jsonify({'error': 'An issue can only be reported after the delivery is completed.'}), 409
            issues = data.setdefault('delivery_issues', [])
            if any(
                (item.get('task_id') or item.get('delivery_id')) == task_id
                and (item.get('reporter_id') or item.get('receiver_id')) == user.get('id')
                for item in issues
            ):
                return jsonify({'error': 'You have already reported an issue for this delivery.'}), 409

            created_at = utc_now()
            donation_id = delivery_task_donation_id(data, task)
            issue = {
                'id': f'issue-{uuid.uuid4().hex[:10]}',
                'request_id': request_item.get('id'),
                'donation_id': donation_id,
                'delivery_id': task_id,
                'task_id': task_id,
                'receiver_id': user['id'],
                'reporter_id': user['id'],
                'category': str(payload.get('category') or 'delivery').strip(),
                'description': description,
                'status': 'open',
                'resolution_note': '',
                'status_history': [{
                    'status': 'open',
                    'changed_by': user['id'],
                    'created_at': created_at,
                }],
                'created_at': created_at,
                'updated_at': created_at,
            }
            issues.append(issue)
            notify_user(
                data,
                task.get('ngo_id'),
                f'A delivery issue was reported for request {request_item.get("id")} (delivery {task_id}).',
                notification_type='delivery_issue',
            )
            save_data(data)
        return jsonify({'issue': serialize_delivery_issue(data, issue)}), 201

    if user.get('role') == 'volunteer':
        if task.get('volunteer_id') != user.get('id'):
            return jsonify({'error': 'You can only view issues for your own deliveries.'}), 403
        issues = [
            {key: value for key, value in item.items() if key not in {'receiver_id', 'receiver_name'}}
            for item in data.get('delivery_issues', [])
            if item.get('task_id') == task_id
        ]
    elif user.get('role') == 'ngo' and task.get('ngo_id') == user.get('id'):
        issues = [
            item for item in data.get('delivery_issues', [])
            if item.get('task_id') == task_id
        ]
    elif user.get('role') == 'requester' and request_item and request_item.get('requester_id', request_item.get('ngo_id')) == user.get('id'):
        issues = [
            item for item in data.get('delivery_issues', [])
            if (item.get('task_id') or item.get('delivery_id')) == task_id
            and (item.get('reporter_id') or item.get('receiver_id')) == user.get('id')
        ]
    elif user.get('role') == 'donor':
        donation_id = delivery_task_donation_id(data, task)
        donation = next(
            (item for item in data.get('donations', []) if item.get('id') == donation_id),
            None,
        )
        if not donation or donation.get('donor_id') != user.get('id'):
            return jsonify({'error': 'You are not authorized to view issues for this delivery.'}), 403
        issues = [
            item for item in data.get('delivery_issues', [])
            if (item.get('task_id') or item.get('delivery_id')) == task_id
        ]
    else:
        return jsonify({'error': 'You are not authorized to view issues for this delivery.'}), 403
    serialized_issues = [serialize_delivery_issue(data, issue) for issue in issues]
    if user.get('role') == 'volunteer':
        serialized_issues = [
            {key: value for key, value in issue.items() if key not in {'receiver_id', 'reporter_id'}}
            for issue in serialized_issues
        ]
    return jsonify({'issues': serialized_issues})


@app.route('/api/delivery-issues/<issue_id>', methods=['GET', 'PATCH'])
def update_delivery_issue(issue_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    issue = next(
        (item for item in data.get('delivery_issues', []) if item.get('id') == issue_id),
        None,
    )
    if not issue:
        return jsonify({'error': 'Delivery issue not found.'}), 404
    task, request_item, donation = delivery_issue_context(data, issue)
    if request.method == 'GET':
        if not delivery_issue_visible_to_user(user, issue, task, request_item, donation):
            return jsonify({'error': 'You are not authorized to view this delivery issue.'}), 403
        return jsonify({'issue': serialize_delivery_issue(data, issue)})

    if user.get('role') != 'ngo':
        return jsonify({'error': 'Only the coordinating NGO can update issue status.'}), 403
    payload = request.get_json(silent=True) or {}
    next_status = str(payload.get('status') or '').strip().casefold().replace(' ', '_')
    if next_status not in {'reported', 'open', 'under_review', 'resolved'}:
        return jsonify({'error': 'Issue status must be Reported, Open, Under Review, or Resolved.'}), 400
    if not task or task.get('ngo_id') != user.get('id'):
        return jsonify({'error': 'You can only update issues for deliveries coordinated by your organization.'}), 403

    current_status = issue.get('status', 'reported')
    valid_next_status = {
        'reported': {'reported', 'under_review'},
        'open': {'open', 'under_review'},
        'under_review': {'under_review', 'resolved'},
        'resolved': {'resolved'},
    }
    if next_status not in valid_next_status.get(current_status, set()):
        return jsonify({'error': f'Issue cannot transition from {current_status} to {next_status}.'}), 409

    resolution_note = str(payload.get('resolution_note', issue.get('resolution_note', '')) or '').strip()
    action_taken = issue.get('action_taken')
    if 'action_taken' in payload:
        if current_status != 'under_review' or next_status not in {'under_review', 'resolved'}:
            return jsonify({'error': 'Action taken can only be recorded while the issue is under review.'}), 409
        if not isinstance(payload['action_taken'], bool):
            return jsonify({'error': 'Action taken must be Yes or No.'}), 400
        action_taken = payload['action_taken']
        if not action_taken:
            resolution_note = ''
    if next_status == 'resolved' and current_status != 'under_review':
        return jsonify({'error': 'An issue must be under review before it can be resolved.'}), 409
    if next_status == 'resolved' and action_taken is not True:
        return jsonify({'error': 'Save Yes for action taken before resolving this issue.'}), 409
    response_changed = resolution_note != str(issue.get('resolution_note') or '').strip()
    action_changed = 'action_taken' in payload and issue.get('action_taken') is not action_taken
    changed = (
        current_status != next_status
        or response_changed
        or action_changed
    )
    if changed:
        issue['resolution_note'] = resolution_note
        if 'action_taken' in payload:
            issue['action_taken'] = action_taken
        issue['updated_at'] = utc_now()
    if current_status != next_status:
        issue['status'] = next_status
        history = issue.setdefault('status_history', [])
        if not history or history[-1].get('status') != next_status:
            history.append({
                'status': next_status,
                'changed_by': user['id'],
                'created_at': issue['updated_at'],
            })
        notify_user(
            data,
            issue.get('reporter_id') or issue.get('receiver_id'),
            f'Your delivery issue for delivery {task.get("id")} is now {next_status.replace("_", " ")}.',
            notification_type='delivery_issue',
        )
    elif response_changed or action_changed:
        notify_user(
            data,
            issue.get('reporter_id') or issue.get('receiver_id'),
            f'The NGO updated its action for your delivery issue for delivery {task.get("id")}.',
            notification_type='delivery_issue',
        )
    if changed:
        save_data(data)
    return jsonify({'issue': serialize_delivery_issue(data, issue)})


@app.route('/api/community-needs', methods=['GET'])
def list_needs():
    user = current_user_from_auth()
    public_scope = not user or request.args.get('scope') == 'public_dashboard'
    if user and user['role'] == 'volunteer' and not public_scope:
        return jsonify({'error': 'Community needs are not part of the volunteer delivery workflow.'}), 403
    data = load_data()
    contributions = data.get('community_need_contributions', [])
    need_tasks = [
        task for task in data.get('delivery_tasks', [])
        if task.get('community_need_id') or task.get('community_contribution_id')
    ]
    task_by_contribution = {
        task.get('community_contribution_id'): task
        for task in need_tasks
        if task.get('community_contribution_id')
    }
    if public_scope:
        public_needs = []
        for need in data.get('community_needs', []):
            need_contributions = [
                item for item in contributions if item.get('need_id') == need.get('id')
            ]
            delivered_quantity = sum(
                float(item.get('quantity', 0) or 0)
                for item in need_contributions
                if item.get('status') == 'delivered'
                or (task_by_contribution.get(item.get('id')) or {}).get('status') == 'delivered'
            )
            required_quantity = float(need.get('required_quantity', 0) or 0)
            status = need.get('status', 'open')
            if required_quantity > 0 and delivered_quantity >= required_quantity:
                status = 'fulfilled'
            elif status == 'fulfilled':
                status = 'pending_delivery' if need_contributions else 'open'
            if status not in {'open', 'partial', 'pending_delivery'}:
                continue
            public_needs.append({
                'id': need.get('id'),
                'category': need.get('category', ''),
                'required_quantity': required_quantity,
                'delivered_quantity': delivered_quantity,
                'remaining_quantity': max(0, required_quantity - delivered_quantity),
                'servings': need.get('servings', 0),
                'location': need.get('location', ''),
                'city': need.get('city', ''),
                'urgency': need.get('urgency', ''),
                'required_date': need.get('required_date', ''),
                'description': need.get('description', ''),
                'status': status,
                'organization_name': next(
                    (
                        str(profile.get('organization_name') or '').strip()
                        for profile in data.get('profiles', [])
                        if profile.get('id') == need.get('ngo_id')
                        and profile.get('role') == 'ngo'
                    ),
                    '',
                ),
                'created_at': need.get('created_at', ''),
                'updated_at': need.get('updated_at', ''),
            })
        return jsonify({'needs': public_needs})

    corrected_legacy_status = False
    for need in data.get('community_needs', []):
        need_contributions = [item for item in contributions if item.get('need_id') == need.get('id')]
        delivered_quantity = sum(
            float(item.get('quantity', 0) or 0)
            for item in need_contributions
            if item.get('status') == 'delivered'
            or (task_by_contribution.get(item.get('id')) or {}).get('status') == 'delivered'
        )
        required_quantity = float(need.get('required_quantity', 0) or 0)
        if required_quantity > 0 and delivered_quantity >= required_quantity and need.get('status') != 'fulfilled':
            need['status'] = 'fulfilled'
            need['updated_at'] = utc_now()
            corrected_legacy_status = True
        elif need.get('status') == 'fulfilled' and delivered_quantity < required_quantity:
            need['status'] = 'pending_delivery' if need_contributions else 'open'
            need['updated_at'] = utc_now()
            corrected_legacy_status = True
    if corrected_legacy_status:
        save_data(data)

    if user['role'] == 'ngo':
        needs = [need for need in data['community_needs'] if need['ngo_id'] == user['id']]
    elif user['role'] in {'donor', 'admin'}:
        needs = [need for need in data['community_needs'] if need['status'] in {'open', 'partial', 'pending_delivery'}]
    else:
        needs = []
    if user['role'] == 'donor':
        for need in needs:
            own_response = next(
                (
                    item for item in data.get('community_need_contributions', [])
                    if item.get('need_id') == need.get('id') and item.get('donor_id') == user['id']
                ),
                None,
            )
            need['has_responded'] = own_response is not None
            need['pickup_location'] = own_response.get('pickup_location', '') if own_response else ''
            need['pickup_location_locked'] = bool(
                own_response
                and (
                    own_response.get('status') in {'assigned', 'delivered'}
                    or own_response.get('delivery_task_id')
                )
            )
    if user['role'] == 'ngo':
        profiles_by_id = {profile.get('id'): profile for profile in data.get('profiles', [])}
        tasks_by_contribution = {
            task.get('community_contribution_id'): task
            for task in data.get('delivery_tasks', [])
            if task.get('community_contribution_id')
        }
        for need in needs:
            contributions = [
                contribution for contribution in data.get('community_need_contributions', [])
                if contribution.get('need_id') == need.get('id')
            ]
            need['contributions'] = []
            for contribution in contributions:
                donor = profiles_by_id.get(contribution.get('donor_id'), {})
                task = tasks_by_contribution.get(contribution.get('id'))
                need['contributions'].append({
                    **contribution,
                    'status': contribution.get('status', 'responded'),
                    'donor_name': donor.get('full_name', 'Donor'),
                    'delivery_status': task.get('status') if task else None,
                    'delivery_task_id': task.get('id') if task else contribution.get('delivery_task_id'),
                    'volunteer_name': next(
                        (
                            profile.get('full_name', '')
                            for profile in data.get('profiles', [])
                            if task and profile.get('id') == task.get('volunteer_id')
                        ),
                        '',
                    ),
                })
            need['delivered_quantity'] = sum(
                float(contribution.get('quantity', 0) or 0)
                for contribution in contributions
                if contribution.get('status') == 'delivered'
            )
    return jsonify({'needs': needs})


@app.route('/api/community-needs', methods=['POST'])
def create_need():
    user = current_user_from_auth()
    if not user or user['role'] != 'ngo':
        return jsonify({'error': 'Only NGOs can create community needs.'}), 403
    payload = request.get_json(silent=True) or {}
    required = ['category', 'required_quantity', 'location', 'urgency', 'required_date', 'description']
    missing = [field for field in required if not payload.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    data = load_data()
    need = {
        'id': f'need-{uuid.uuid4().hex[:8]}',
        'ngo_id': user['id'],
        'category': payload['category'],
        'required_quantity': float(payload['required_quantity']),
        'servings': int(payload.get('servings', payload['required_quantity'])),
        'location': payload['location'],
        'city': payload.get('city', user.get('city', '')),
        'urgency': payload['urgency'],
        'required_date': payload['required_date'],
        'description': payload['description'],
        'status': 'open',
        'created_at': utc_now(),
        'updated_at': utc_now(),
    }
    data['community_needs'].append(need)
    data['notifications'].append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': user['id'],
        'message': 'Your community food need has been posted successfully.',
        'type': 'community_need',
        'link': '/ngo',
        'read_at': None,
        'created_at': utc_now(),
    })
    save_data(data)
    return jsonify({'need': need}), 201


@app.route('/api/community-needs/<need_id>', methods=['PATCH', 'DELETE'])
def update_community_need(need_id):
    user = current_user_from_auth()
    if not user or user.get('role') != 'ngo':
        if request.method == 'DELETE':
            return jsonify({'error': 'Only NGOs can delete community needs.'}), 403
        return jsonify({'error': 'Only NGOs can update community needs.'}), 403

    if request.method == 'DELETE':
        data = load_data()
        need = next(
            (item for item in data.get('community_needs', []) if item.get('id') == need_id),
            None,
        )
        if not need:
            return jsonify({'error': 'Community need not found.'}), 404
        if need.get('ngo_id') != user.get('id'):
            return jsonify({'error': 'You can only delete your organization’s community needs.'}), 403

        contribution_ids = {
            item.get('id')
            for item in data.get('community_need_contributions', [])
            if item.get('need_id') == need_id and item.get('id')
        }
        request_ids = {
            item.get('id')
            for item in data.get('donation_requests', [])
            if (
                item.get('need_id') == need_id
                or item.get('community_need_id') == need_id
                or item.get('community_contribution_id') in contribution_ids
            ) and item.get('id')
        }
        request_contribution_ids = {
            item.get('id')
            for item in data.get('request_contributions', [])
            if (
                item.get('need_id') == need_id
                or item.get('community_need_id') == need_id
                or item.get('community_contribution_id') in contribution_ids
                or item.get('request_id') in request_ids
            ) and item.get('id')
        }
        task_ids = {
            item.get('id')
            for item in data.get('delivery_tasks', [])
            if (
                item.get('community_need_id') == need_id
                or item.get('community_contribution_id') in contribution_ids
                or item.get('request_id') in request_ids
                or item.get('request_contribution_id') in request_contribution_ids
            ) and item.get('id')
        }
        feedback_ids = {
            item.get('id')
            for item in data.get('delivery_feedback', [])
            if item.get('task_id') in task_ids and item.get('id')
        }
        issue_ids = {
            item.get('id')
            for item in data.get('delivery_issues', [])
            if (item.get('task_id') or item.get('delivery_id')) in task_ids and item.get('id')
        }

        data['community_needs'] = [
            item for item in data.get('community_needs', [])
            if item.get('id') != need_id
        ]
        data['community_need_contributions'] = [
            item for item in data.get('community_need_contributions', [])
            if item.get('id') not in contribution_ids and item.get('need_id') != need_id
        ]
        data['donation_requests'] = [
            item for item in data.get('donation_requests', [])
            if (
                item.get('id') not in request_ids
                and item.get('need_id') != need_id
                and item.get('community_need_id') != need_id
                and item.get('community_contribution_id') not in contribution_ids
            )
        ]
        data['request_contributions'] = [
            item for item in data.get('request_contributions', [])
            if (
                item.get('id') not in request_contribution_ids
                and item.get('need_id') != need_id
                and item.get('community_need_id') != need_id
                and item.get('community_contribution_id') not in contribution_ids
                and item.get('request_id') not in request_ids
            )
        ]
        data['delivery_tasks'] = [
            item for item in data.get('delivery_tasks', [])
            if (
                item.get('id') not in task_ids
                and item.get('community_need_id') != need_id
                and item.get('community_contribution_id') not in contribution_ids
                and item.get('request_id') not in request_ids
                and item.get('request_contribution_id') not in request_contribution_ids
            )
        ]
        data['delivery_feedback'] = [
            item for item in data.get('delivery_feedback', [])
            if (
                item.get('id') not in feedback_ids
                and item.get('task_id') not in task_ids
                and item.get('community_need_id') != need_id
                and item.get('community_contribution_id') not in contribution_ids
            )
        ]
        data['delivery_issues'] = [
            item for item in data.get('delivery_issues', [])
            if (
                item.get('id') not in issue_ids
                and item.get('task_id') not in task_ids
                and item.get('delivery_id') not in task_ids
                and item.get('community_need_id') != need_id
                and item.get('community_contribution_id') not in contribution_ids
            )
        ]
        data['distribution_records'] = [
            item for item in data.get('distribution_records', [])
            if (
                item.get('task_id') not in task_ids
                and item.get('delivery_task_id') not in task_ids
                and item.get('need_id') != need_id
                and item.get('community_need_id') != need_id
                and item.get('community_contribution_id') not in contribution_ids
                and item.get('request_id') not in request_ids
                and item.get('request_contribution_id') not in request_contribution_ids
            )
        ]
        data['notifications'] = [
            item for item in data.get('notifications', [])
            if (
                item.get('need_id') != need_id
                and item.get('community_need_id') != need_id
                and item.get('community_contribution_id') not in contribution_ids
                and item.get('request_id') not in request_ids
                and item.get('request_contribution_id') not in request_contribution_ids
                and item.get('task_id') not in task_ids
                and item.get('delivery_task_id') not in task_ids
                and item.get('feedback_id') not in feedback_ids
                and item.get('issue_id') not in issue_ids
            )
        ]
        save_data(data)
        return jsonify({'success': True, 'deleted_id': need_id})

    payload = request.get_json(silent=True) or {}
    required = ('category', 'required_quantity', 'location', 'urgency', 'required_date', 'description')
    missing = [field for field in required if not payload.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400
    try:
        required_quantity = float(payload['required_quantity'])
    except (TypeError, ValueError):
        return jsonify({'error': 'Required quantity must be a positive number.'}), 400
    if not math.isfinite(required_quantity) or required_quantity <= 0:
        return jsonify({'error': 'Required quantity must be a positive number.'}), 400

    data = load_data()
    need = next(
        (item for item in data.get('community_needs', []) if item.get('id') == need_id),
        None,
    )
    if not need:
        return jsonify({'error': 'Community need not found.'}), 404
    if need.get('ngo_id') != user.get('id'):
        return jsonify({'error': 'You can only update your organization’s community needs.'}), 403

    previous_quantity = float(need.get('required_quantity', 0) or 0)
    need.update({
        'category': str(payload['category']).strip(),
        'required_quantity': required_quantity,
        'location': str(payload['location']).strip(),
        'city': str(payload.get('city') or '').strip(),
        'urgency': str(payload['urgency']).strip(),
        'required_date': str(payload['required_date']).strip(),
        'description': str(payload['description']).strip(),
        'updated_at': utc_now(),
    })
    if float(need.get('servings', previous_quantity) or 0) == previous_quantity:
        need['servings'] = int(required_quantity)

    save_data(data)
    return jsonify({'need': need})


@app.route('/api/community-needs/<need_id>/respond', methods=['POST', 'PATCH'])
def respond_to_need(need_id):
    user = current_user_from_auth()
    if not user or user['role'] not in {'donor', 'ngo'}:
        return jsonify({'error': 'Only donors and NGOs can respond to community needs.'}), 403

    payload = request.get_json(silent=True) or {}
    pickup_location = str(payload.get('pickup_location') or '').strip()
    if not pickup_location:
        return jsonify({'error': 'Enter the donor pickup location so the volunteer can collect the food.'}), 400

    data = load_data()
    need = next((n for n in data['community_needs'] if n['id'] == need_id), None)
    if not need:
        return jsonify({'error': 'Need not found.'}), 404
    if request.method == 'PATCH':
        contribution = next(
            (
                item for item in data.get('community_need_contributions', [])
                if item.get('need_id') == need_id and item.get('donor_id') == user['id']
            ),
            None,
        )
        if not contribution:
            return jsonify({'error': 'Your response to this need was not found.'}), 404
        if contribution.get('status') in {'assigned', 'delivered'} or contribution.get('delivery_task_id'):
            return jsonify({'error': 'Pickup location cannot be changed after delivery assignment.'}), 409
        contribution['pickup_location'] = pickup_location
        contribution['updated_at'] = utc_now()
        save_data(data)
        return jsonify({'success': True, 'need': need, 'contribution': contribution})

    try:
        quantity = float(payload.get('quantity', 0) or 0)
    except (TypeError, ValueError):
        return jsonify({'error': 'Response quantity must be a valid number.'}), 400
    if quantity <= 0:
        return jsonify({'error': 'Response quantity must be greater than zero.'}), 400
    if need.get('status') == 'fulfilled':
        return jsonify({'error': 'This community need has already been fulfilled.'}), 409
    if any(
        item.get('need_id') == need_id and item.get('donor_id') == user['id']
        for item in data.get('community_need_contributions', [])
    ):
        return jsonify({'error': 'You have already responded to this community need.'}), 409

    contribution = {
        'id': f'contrib-{uuid.uuid4().hex[:8]}',
        'need_id': need_id,
        'donor_id': user['id'],
        'quantity': quantity,
        'pickup_location': pickup_location,
        'status': 'responded',
        'created_at': utc_now(),
    }
    data.setdefault('community_need_contributions', []).append(contribution)
    need['status'] = 'pending_delivery'
    need['updated_at'] = utc_now()
    data['notifications'].append({
        'id': f'notify-{uuid.uuid4().hex[:8]}',
        'user_id': need['ngo_id'],
        'message': f'{user["full_name"]} responded to the need for {quantity} servings.',
        'type': 'community_need',
        'link': '/ngo',
        'read_at': None,
        'created_at': utc_now(),
    })
    save_data(data)
    return jsonify({'success': True, 'need': need, 'contribution': contribution})


@app.route('/api/community-needs/available-volunteers', methods=['GET'])
def community_need_available_volunteers():
    user = current_user_from_auth()
    if not user or user.get('role') != 'ngo':
        return jsonify({'error': 'Only NGOs can assign community need deliveries.'}), 403

    data = load_data()
    active_volunteer_ids = {
        task.get('volunteer_id')
        for task in data.get('delivery_tasks', [])
        if task.get('volunteer_id') and task.get('status') in {'assigned', 'accepted', 'picked_up', 'in_transit'}
    }
    today = datetime.now(timezone.utc).date().isoformat()
    unavailable_ids = {
        entry.get('volunteer_id')
        for entry in data.get('volunteer_availability', [])
        if entry.get('date') == today and entry.get('status') == 'unavailable'
    }
    volunteer_groups = {}
    for profile in data.get('profiles', []):
        volunteer_id = profile.get('id')
        if profile.get('role') != 'volunteer' or not volunteer_id:
            continue
        normalized_name = ' '.join(str(profile.get('full_name') or '').split()).casefold()
        identity_key = normalized_name or volunteer_id
        volunteer_groups.setdefault(identity_key, {})[volunteer_id] = profile

    volunteers = []
    for profiles_by_id in volunteer_groups.values():
        volunteer_ids = set(profiles_by_id)
        if volunteer_ids.intersection(active_volunteer_ids | unavailable_ids):
            continue
        delivered_counts = {
            volunteer_id: sum(
                1 for task in data.get('delivery_tasks', [])
                if task.get('volunteer_id') == volunteer_id and task.get('status') == 'delivered'
            )
            for volunteer_id in volunteer_ids
        }
        representative_id = min(
            volunteer_ids,
            key=lambda volunteer_id: (
                -delivered_counts[volunteer_id],
                profiles_by_id[volunteer_id].get('created_at') or '',
                volunteer_id,
            ),
        )
        volunteers.append(serialize_profile(profiles_by_id[representative_id]))

    return jsonify({'volunteers': [
        {'id': volunteer['id'], 'full_name': volunteer.get('full_name', ''), 'city': volunteer.get('city', '')}
        for volunteer in volunteers
    ]})


@app.route('/api/community-needs/<need_id>/assign', methods=['POST'])
def assign_community_need_delivery(need_id):
    user = current_user_from_auth()
    if not user or user.get('role') != 'ngo':
        return jsonify({'error': 'Only NGOs can assign community need deliveries.'}), 403

    payload = request.get_json(silent=True) or {}
    contribution_id = str(payload.get('contribution_id') or '').strip()
    volunteer_id = str(payload.get('volunteer_id') or '').strip()
    if not contribution_id or not volunteer_id:
        return jsonify({'error': 'A donor response and volunteer are required.'}), 400

    data = load_data()
    need = next((item for item in data.get('community_needs', []) if item.get('id') == need_id), None)
    if not need:
        return jsonify({'error': 'Community need not found.'}), 404
    if need.get('ngo_id') != user['id']:
        return jsonify({'error': 'You can only assign deliveries for your organization’s community needs.'}), 403
    need_deadline = task_deadline_datetime(need.get('required_date'), date_only_is_end_of_day=True)
    if need_deadline is not None and need_deadline <= datetime.now().astimezone():
        return jsonify({'error': 'The community need deadline has passed; a delivery task cannot be assigned.'}), 409

    contribution = next(
        (
            item for item in data.get('community_need_contributions', [])
            if item.get('id') == contribution_id and item.get('need_id') == need_id
        ),
        None,
    )
    if not contribution:
        return jsonify({'error': 'Donor response not found for this community need.'}), 404
    if contribution.get('status') in {'assigned', 'delivered'} or any(
        task.get('community_contribution_id') == contribution_id
        for task in data.get('delivery_tasks', [])
    ):
        return jsonify({'error': 'This donor response already has a delivery task.'}), 409
    pickup_location = str(contribution.get('pickup_location') or '').strip()
    if not pickup_location:
        return jsonify({'error': 'The donor response does not include a pickup location.'}), 400

    volunteer = next(
        (
            profile for profile in data.get('profiles', [])
            if profile.get('id') == volunteer_id and profile.get('role') == 'volunteer'
        ),
        None,
    )
    if not volunteer:
        return jsonify({'error': 'Available volunteer not found.'}), 404
    if any(
        task.get('volunteer_id') == volunteer_id
        and task.get('status') in {'assigned', 'accepted', 'picked_up', 'in_transit'}
        for task in data.get('delivery_tasks', [])
    ):
        return jsonify({'error': 'This volunteer already has an active delivery.'}), 409
    today = datetime.now(timezone.utc).date().isoformat()
    if any(
        entry.get('volunteer_id') == volunteer_id
        and entry.get('date') == today
        and entry.get('status') == 'unavailable'
        for entry in data.get('volunteer_availability', [])
    ):
        return jsonify({'error': 'This volunteer has marked themselves unavailable today.'}), 409

    assigned_at = utc_now()
    task = {
        'id': f'delivery-{uuid.uuid4().hex[:10]}',
        'request_id': None,
        'donation_id': None,
        'community_need_id': need_id,
        'community_contribution_id': contribution_id,
        'ngo_id': user['id'],
        'volunteer_id': volunteer_id,
        'pickup_location': pickup_location,
        'pickup_instructions': str(contribution.get('pickup_instructions') or '').strip(),
        'dropoff_location': ', '.join(
            part for part in [str(need.get('location') or '').strip(), str(need.get('city') or '').strip()] if part
        ),
        'dropoff_instructions': str(need.get('description') or '').strip(),
        'status': 'assigned',
        'status_history': [{
            'status': 'assigned',
            'changed_by': user['id'],
            'created_at': assigned_at,
        }],
        'created_at': assigned_at,
        'updated_at': assigned_at,
    }
    data.setdefault('delivery_tasks', []).append(task)
    contribution['status'] = 'assigned'
    contribution['delivery_task_id'] = task['id']
    contribution['volunteer_id'] = volunteer_id
    contribution['assigned_at'] = assigned_at
    need['status'] = 'pending_delivery'
    need['updated_at'] = assigned_at
    data.setdefault('notifications', []).extend([
        {
            'id': f'notify-{uuid.uuid4().hex[:8]}',
            'user_id': volunteer_id,
            'message': f'You have been assigned a delivery for the {need.get("category", "community food")} community need.',
            'type': 'delivery',
            'link': '/dashboard',
            'read_at': None,
            'created_at': assigned_at,
        },
        {
            'id': f'notify-{uuid.uuid4().hex[:8]}',
            'user_id': user['id'],
            'message': f'{volunteer.get("full_name", "A volunteer")} was assigned to a community need delivery.',
            'type': 'community_need',
            'link': '/dashboard',
            'read_at': None,
            'created_at': assigned_at,
        },
    ])
    save_data(data)
    return jsonify({'task': task, 'contribution': contribution, 'need': need}), 201


@app.route('/api/notifications', methods=['GET', 'DELETE'])
def list_notifications():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    if request.method == 'DELETE':
        before_count = len(data.get('notifications', []))
        data['notifications'] = [
            item for item in data.get('notifications', [])
            if item.get('user_id') != user['id']
        ]
        deleted_count = before_count - len(data['notifications'])
        save_data(data)
        return jsonify({'success': True, 'deleted_count': deleted_count})

    notifications = [n for n in data.get('notifications', []) if n['user_id'] == user['id']]
    notifications.sort(key=lambda item: item['created_at'], reverse=True)
    return jsonify({'notifications': notifications, 'unread_count': sum(1 for n in notifications if n['read_at'] is None)})


@app.route('/api/notifications/<notification_id>', methods=['DELETE'])
def delete_notification(notification_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    data = load_data()
    notification = next(
        (
            item for item in data.get('notifications', [])
            if item.get('id') == notification_id and item.get('user_id') == user['id']
        ),
        None,
    )
    if not notification:
        return jsonify({'error': 'Notification not found.'}), 404

    data['notifications'] = [
        item for item in data.get('notifications', [])
        if item.get('id') != notification_id
    ]
    save_data(data)
    return jsonify({'success': True, 'deleted_id': notification_id})


@app.route('/api/notifications/<notification_id>/read', methods=['POST'])
def mark_notification_read(notification_id):
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    item = next((n for n in data['notifications'] if n['id'] == notification_id and n['user_id'] == user['id']), None)
    if not item:
        return jsonify({'error': 'Notification not found'}), 404
    item['read_at'] = utc_now()
    save_data(data)
    return jsonify({'success': True})


@app.route('/api/notifications/read-all', methods=['POST'])
def mark_all_notifications_read():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    for item in data['notifications']:
        if item['user_id'] == user['id'] and item['read_at'] is None:
            item['read_at'] = utc_now()
    save_data(data)
    return jsonify({'success': True})


@app.route('/api/analytics/summary', methods=['GET'])
def analytics_summary():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    completed = [d for d in data['donations'] if d['status'] == 'completed']
    donated = sum(float(d.get('quantity', 0)) for d in completed)
    active_donors = len({d['donor_id'] for d in data['donations']})
    active_ngos = len({r['ngo_id'] for r in data['donation_requests']})
    current_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    chart_data = []
    for month_offset in range(4, -1, -1):
        month_date = (current_month.replace(day=28) - timedelta(days=month_offset * 31)).replace(day=1)
        next_month = (month_date.replace(day=28) + timedelta(days=4)).replace(day=1)

        def created_in_month(record):
            try:
                created_at = datetime.fromisoformat(str(record.get('created_at', '')).replace('Z', '+00:00'))
            except ValueError:
                return False
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            return month_date <= created_at < next_month

        chart_data.append({
            'month': month_date.strftime('%b'),
            'donations': sum(1 for item in data['donations'] if created_in_month(item)),
            'requests': sum(1 for item in data['donation_requests'] if created_in_month(item)),
        })
    return jsonify({'summary': {'food_donated_kg': round(donated, 1), 'completed_donations': len(completed), 'estimated_servings': sum(int(d.get('servings') or 0) for d in completed), 'active_donors': active_donors, 'active_ngos': active_ngos}, 'chart_data': chart_data})


@app.route('/api/ai/match', methods=['GET'])
def ai_match():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401

    api_key = os.getenv('GEMINI_API_KEY')
    if api_key:
        try:
            payload = {'contents': [{'parts': [{'text': 'Suggest food donation matches for NGOs in India with urgency and location context.'}]}]}
            response = requests.post(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
                params={'key': api_key},
                json=payload,
                timeout=15,
            )
            response.raise_for_status()
            result = response.json()
            text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
            return jsonify({'match': {'title': 'AI recommendation', 'reason': text[:300] if text else 'Based on urgency and city proximity.', 'confidence': 'High'}})
        except Exception as exc:
            app.logger.warning('Gemini request failed: %s', str(exc))

    data = load_data()
    donation = next(
        (item for item in data.get('donations', []) if donation_is_requestable(data, item)),
        None,
    )
    need = next((n for n in data['community_needs'] if n['status'] == 'open'), None)
    if donation and need:
        return jsonify({'match': {'title': 'Suggested match', 'reason': f'{donation["food_name"]} in {donation["city"]} fits the urgent {need["category"]} request in {need["location"]}.', 'confidence': 'Medium'}})
    return jsonify({'match': {'title': 'Suggested match', 'reason': 'No active needs are currently requiring a match. Keep listing food donations to help the network.', 'confidence': 'Low'}})


@app.route('/api/ai/forecast', methods=['GET'])
def ai_forecast():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    data = load_data()
    if len(data['donations']) < 3:
        return jsonify({'forecast': {'label': 'Insufficient data', 'message': 'There are not enough historical records to create a concrete demand forecast yet.'}})
    total = sum(float(d.get('quantity', 0)) for d in data['donations'])
    return jsonify({'forecast': {'label': 'Estimated demand', 'message': f'Based on recent activity, the network may need about {round(total / 3, 1)} units in the next 7 days.', 'estimate': round(total / 3, 1)}})


@app.route('/api/admin/users', methods=['GET'])
def admin_users():
    user = current_user_from_auth()
    if not user or user['role'] != 'admin':
        return jsonify({'error': 'Admin privileges required.'}), 403
    data = load_data()
    return jsonify({'users': data['profiles']})


@app.route('/api/admin/reports', methods=['GET'])
def admin_reports():
    user = current_user_from_auth()
    if not user or user['role'] != 'admin':
        return jsonify({'error': 'Admin privileges required.'}), 403
    data = load_data()
    return jsonify({'reports': {'donations': len(data['donations']), 'requests': len(data['donation_requests']), 'needs': len(data['community_needs']), 'stories': len(data['impact_stories'])}})


@app.route('/api/upload', methods=['POST'])
def upload_file():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded.'}), 400
    uploaded = request.files['file']
    if not uploaded.filename:
        return jsonify({'error': 'File name is required.'}), 400
    mime_extensions = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
    }
    expected_extension = mime_extensions.get(uploaded.mimetype)
    if not expected_extension:
        return jsonify({'error': 'Only JPG, PNG, and WebP images are allowed.'}), 400
    image_bytes = uploaded.read(MAX_UPLOAD_SIZE_BYTES + 1)
    if len(image_bytes) > MAX_UPLOAD_SIZE_BYTES:
        return jsonify({'error': 'Images must be 16 MB or smaller.'}), 413
    if _image_bytes_extension(image_bytes) != expected_extension:
        return jsonify({'error': 'The uploaded file is not a valid JPG, PNG, or WebP image.'}), 400

    file_name = f'{uuid.uuid4().hex}{expected_extension}'
    path = UPLOAD_DIR / file_name
    temporary_path = UPLOAD_DIR / f'{file_name}.{uuid.uuid4().hex}.tmp'
    try:
        temporary_path.write_bytes(image_bytes)
        temporary_path.replace(path)
    except OSError:
        app.logger.exception('Could not persist uploaded food image.')
        return jsonify({'error': 'Unable to save the uploaded image. Please try again.'}), 500
    finally:
        temporary_path.unlink(missing_ok=True)
    return jsonify({'url': f'/uploads/{file_name}', 'name': file_name})


@app.route('/uploads/<filename>', methods=['GET'])
def uploaded_files(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route('/api/profile', methods=['GET', 'PATCH'])
def get_profile():
    user = current_user_from_auth()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if request.method == 'GET':
        return jsonify({'user': serialize_profile(user)})
    if user.get('role') != 'ngo':
        return jsonify({'error': 'Only NGOs can update organization profile details.'}), 403

    payload = request.get_json(silent=True) or {}
    allowed_fields = ('full_name', 'organization_name', 'phone', 'address', 'city')
    data = load_data()
    profile = find_profile_by_id(data, user['id'])
    if not profile:
        return jsonify({'error': 'Profile not found.'}), 404
    for field in allowed_fields:
        if field in payload:
            value = str(payload[field]).strip()
            if field == 'full_name' and not value:
                return jsonify({'error': 'Contact name cannot be empty.'}), 400
            profile[field] = value
    save_data(data)
    return jsonify({'user': serialize_profile(profile)})


if __name__ == '__main__':
    port = int(os.getenv('PORT', '5001'))
    app.run(host='0.0.0.0', port=port, debug=True)

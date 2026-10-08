import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Flag,
  Download,
  HandHeart,
  HeartHandshake,
  Heart,
  KeyRound,
  Leaf,
  LayoutDashboard,
  LoaderCircle,
  LogIn,
  LogOut,
  LockKeyhole,
  Mail,
  Map as MapIcon,
  MapPin,
  MapPinned,
  MessageCircle,
  Menu,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Trash2,
  Truck,
  Utensils,
  UserRound,
  Users,
  RotateCw,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type Role = 'donor' | 'requester' | 'volunteer' | 'ngo' | 'admin'
type UserRole = Exclude<Role, 'admin'>

function loginUrl(role?: UserRole, next?: string): string {
  const params = new URLSearchParams({ mode: 'login' })
  if (role) params.set('role', role)
  if (next) params.set('next', next)
  return `/auth?${params.toString()}`
}

function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const target = new URL(value, window.location.origin)
    return target.origin === window.location.origin && target.pathname !== '/auth'
      ? `${target.pathname}${target.search}${target.hash}`
      : null
  } catch {
    return null
  }
}

function AuthenticationRequired({ user, authReady = true, children }: {
  user: SessionUser | null
  authReady?: boolean
  children: React.ReactNode
}) {
  const location = useLocation()
  if (!authReady) {
    return <main className="p-8 text-center text-sm text-slate-600" role="status">Checking your session…</main>
  }
  if (user) return children

  const dashboardRole = location.pathname.match(/^\/dashboard\/(donor|requester|volunteer|ngo|admin)(?:\/|$)/)?.[1]
  const role: UserRole | undefined = dashboardRole && isUserRole(dashboardRole)
    ? dashboardRole
    : location.pathname.startsWith('/delivery-feedback/')
      ? 'requester'
      : undefined
  return <Navigate to={loginUrl(role, `${location.pathname}${location.search}${location.hash}`)} replace />
}

function isUserRole(value: string | null): value is UserRole {
  return value === 'donor' || value === 'requester' || value === 'volunteer' || value === 'ngo'
}

function isDashboardRole(value: string | undefined): value is Role {
  return value === 'admin' || isUserRole(value ?? null)
}

function DeliveryFeedbackPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate()
  const { taskId = '' } = useParams()
  const [task, setTask] = useState<DeliveryTask | null>(null)
  const [feedback, setFeedback] = useState<FeedbackEntry | null>(null)
  const [feedbackAlreadySubmitted, setFeedbackAlreadySubmitted] = useState(false)
  const [rating, setRating] = useState('5')
  const [foodCondition, setFoodCondition] = useState('')
  const [deliveryExperience, setDeliveryExperience] = useState('')
  const [comment, setComment] = useState('')
  const [appreciation, setAppreciation] = useState('Thank you for making this delivery possible.')
  const [issues, setIssues] = useState<DeliveryIssue[]>([])
  const [issueDescription, setIssueDescription] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const canSubmit = user.role === 'requester'

  useEffect(() => {
    if (!canSubmit) return
    apiRequest(`/delivery-tasks/${encodeURIComponent(taskId)}/feedback`)
      .then((response) => {
        setTask(response.task)
        setFeedback(response.my_feedback || null)
        setFeedbackAlreadySubmitted(Boolean(response.has_feedback))
        setIssues(response.issues || [])
        if (response.my_feedback) {
          setRating(String(response.my_feedback.rating))
          setFoodCondition(response.my_feedback.food_condition_feedback || '')
          setDeliveryExperience(response.my_feedback.delivery_experience_feedback || response.my_feedback.comment || '')
          setComment(response.my_feedback.comments || response.my_feedback.comment || '')
          setAppreciation(response.my_feedback.appreciation_message || '')
        }
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Unable to load delivery feedback')
      })
      .finally(() => setLoading(false))
  }, [canSubmit, taskId])

  const saveFeedback = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const response = await apiRequest(
        feedback ? `/delivery-feedback/${feedback.id}` : `/delivery-tasks/${encodeURIComponent(taskId)}/feedback`,
        {
          method: feedback ? 'PATCH' : 'POST',
          body: JSON.stringify({
            rating: Number(rating),
            food_condition_feedback: foodCondition,
            delivery_experience_feedback: deliveryExperience,
            comments: comment,
            appreciation_message: appreciation,
          }),
        },
      )
      setFeedback(response.feedback)
      setFeedbackAlreadySubmitted(true)
      setMessage(feedback ? 'Your feedback was updated.' : 'Thank you. Your feedback was submitted.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save feedback')
    } finally {
      setSaving(false)
    }
  }

  const deleteFeedback = async () => {
    if (!feedback || !window.confirm('Delete your feedback for this delivery?')) return
    try {
      await apiRequest(`/delivery-feedback/${feedback.id}`, { method: 'DELETE' })
      setFeedback(null)
      setFeedbackAlreadySubmitted(false)
      setRating('5')
      setFoodCondition('')
      setDeliveryExperience('')
      setComment('')
      setMessage('Your feedback was deleted.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete feedback')
    }
  }

  const reportIssue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const response = await apiRequest(`/delivery-tasks/${encodeURIComponent(taskId)}/issues`, {
        method: 'POST',
        body: JSON.stringify({ category: 'delivery', description: issueDescription }),
      })
      setIssues((current) => current.some((issue) => issue.id === response.issue.id) ? current : [...current, response.issue])
      setMessage('Your delivery issue was reported.')
      navigate(`/delivery-issues/${encodeURIComponent(response.issue.id)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to report delivery issue')
    } finally {
      setSaving(false)
    }
  }

  if (!canSubmit) {
    return <main className="mx-auto max-w-2xl p-6"><section className="section-shell rounded-[28px] p-6"><h1 className="text-2xl font-bold text-slate-900">Feedback unavailable</h1><p className="mt-2 text-sm text-slate-600">Only the receiver who owns a delivered request can submit feedback.</p><Link to={`/dashboard/${user.role}`} className="primary-btn mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><ArrowRight size={16} />Return to dashboard</Link></section></main>
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <section className="section-shell rounded-[28px] p-6">
        <Link to={`/dashboard/${user.role}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#1d4d3d] underline"><ArrowRight className="rotate-180" size={14} />Return to dashboard</Link>
        <h1 className="mt-4 text-3xl font-black text-slate-900">Delivery feedback</h1>
        {loading ? <p className="mt-4 text-sm text-slate-600">Loading delivery…</p> : task ? (
          <>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p><span className="font-semibold">Pickup:</span> {task.pickup_location}</p>
              <p className="mt-1"><span className="font-semibold">Drop-off:</span> {task.dropoff_location}</p>
              <p className="mt-1"><span className="font-semibold">Status:</span> {formatStatus(task.status)}</p>
            </div>
            {feedback && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">You have already submitted feedback. You may edit or delete your own entry.</p>}
            {!feedback && feedbackAlreadySubmitted && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Feedback has already been submitted for this delivery.</p>}
            {(!feedbackAlreadySubmitted || feedback) && (
            <form onSubmit={saveFeedback} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><Star size={16} className="text-amber-500" />Rating (1–5)</span>
                <select value={rating} onChange={(event) => setRating(event.target.value)} className="input-shell mt-2">
                  {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><Utensils size={16} />Food quality / condition</span>
                <textarea value={foodCondition} onChange={(event) => setFoodCondition(event.target.value)} className="input-shell mt-2 min-h-20" maxLength={2000} required />
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><Truck size={16} />Delivery experience</span>
                <textarea value={deliveryExperience} onChange={(event) => setDeliveryExperience(event.target.value)} className="input-shell mt-2 min-h-20" maxLength={2000} required />
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><MessageCircle size={16} />Appreciation message</span>
                <textarea value={appreciation} onChange={(event) => setAppreciation(event.target.value)} className="input-shell mt-2 min-h-16" maxLength={500} required />
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><MessageCircle size={16} />Optional comments</span>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} className="input-shell mt-2 min-h-16" maxLength={2000} />
              </label>
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={saving} className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={16} /> : feedback ? <Save size={16} /> : <Send size={16} />}{saving ? 'Saving…' : feedback ? 'Update feedback' : 'Submit feedback'}</button>
                {feedback && <button type="button" onClick={() => void deleteFeedback()} className="secondary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><Trash2 size={16} />Delete feedback</button>}
              </div>
            </form>
            )}
            {user.role === 'requester' && (
              <section className="mt-6 border-t border-slate-100 pt-5">
                <h2 className="text-lg font-bold text-slate-900">Report an issue</h2>
                {issues.length ? (
                  <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Issue reported · {formatStatus(issues[0].status)}: {issues[0].description}</p>
                ) : feedbackAlreadySubmitted ? (
                  <p className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">Feedback has already been submitted for this delivery.</p>
                ) : (
                  <form onSubmit={reportIssue} className="mt-3 space-y-3">
                    <textarea value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} className="input-shell min-h-24" maxLength={2000} placeholder="Describe what needs attention." required />
                    <button type="submit" disabled={saving} className="secondary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={15} /> : <Send size={15} />}{saving ? 'Submitting…' : 'Submit Issue'}</button>
                  </form>
                )}
              </section>
            )}
          </>
        ) : !message ? <p className="mt-4 text-sm text-slate-600">Delivery details could not be loaded.</p> : null}
        {message && <p role="status" className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
      </section>
    </main>
  )
}

function DeliveryIssuePage({ user }: { user: SessionUser }) {
  const { issueId = '' } = useParams()
  const [issue, setIssue] = useState<DeliveryIssue | null>(null)
  const [status, setStatus] = useState<DeliveryIssue['status']>('open')
  const [resolutionNote, setResolutionNote] = useState('')
  const [actionTaken, setActionTaken] = useState<'' | 'yes' | 'no'>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const canResolve = user.role === 'ngo'

  const loadIssue = useCallback(async () => {
    try {
      const response = await apiRequest(`/delivery-issues/${encodeURIComponent(issueId)}`)
      setIssue(response.issue)
      setStatus(response.issue.status)
      setResolutionNote(response.issue.resolution_note || '')
      setActionTaken(response.issue.action_taken === true ? 'yes' : response.issue.action_taken === false ? 'no' : '')
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load delivery issue.')
    } finally {
      setLoading(false)
    }
  }, [issueId])

  useEffect(() => {
    void loadIssue()
  }, [loadIssue])

  const saveIssue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!issue || !canResolve) return
    setSaving(true)
    setMessage('')
    try {
      const nextStatus = status === 'under_review' && actionTaken === 'yes' ? 'resolved' : status
      const response = await apiRequest(`/delivery-issues/${encodeURIComponent(issue.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          resolution_note: resolutionNote,
          ...(issue.status === 'under_review' && actionTaken ? { action_taken: actionTaken === 'yes' } : {}),
        }),
      })
      setIssue(response.issue)
      setStatus(response.issue.status)
      setResolutionNote(response.issue.resolution_note || '')
      setActionTaken(response.issue.action_taken === true ? 'yes' : response.issue.action_taken === false ? 'no' : '')
      setMessage('Issue update saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update delivery issue.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <section className="section-shell rounded-[28px] p-6">
        <Link to={`/dashboard/${user.role}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#1d4d3d] underline"><ArrowRight className="rotate-180" size={14} />Return to dashboard</Link>
        <h1 className="mt-4 text-3xl font-black text-slate-900">Delivery issue</h1>
        {loading ? <p role="status" className="mt-4 text-sm text-slate-600">Loading issue…</p> : issue ? (
          <>
            <p className="mt-2 text-xs text-slate-500">Issue ID: {issue.id}</p>
            <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <p><span className="font-semibold">Category:</span> {issue.category || 'Delivery'}</p>
              <p><span className="font-semibold">Status:</span> {formatStatus(issue.status)}</p>
              <p><span className="font-semibold">Reporter:</span> {issue.reporter_id || issue.receiver_id || 'Not recorded'}</p>
              <p><span className="font-semibold">Reported:</span> {new Date(issue.created_at).toLocaleString()}</p>
              <p><span className="font-semibold">Delivery:</span> {issue.delivery_id || issue.task_id}</p>
              <p><span className="font-semibold">Request:</span> {issue.request_id || 'Not linked'}</p>
              <p className="sm:col-span-2"><span className="font-semibold">Donation:</span> {issue.donation_id || 'Not linked'}</p>
            </div>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <h2 className="font-semibold text-slate-900">Issue description</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{issue.description}</p>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold text-slate-900">NGO response</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{issue.resolution_note || 'The NGO has not responded yet.'}</p>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Status history</h2>
              <ol className="mt-3 space-y-2 text-sm text-slate-600">
                {(issue.status_history || []).map((entry, index) => (
                  <li key={`${entry.status}-${entry.created_at}-${index}`}>{formatStatus(entry.status)} · {new Date(entry.created_at).toLocaleString()}</li>
                ))}
              </ol>
            </div>
            {canResolve && issue.status !== 'resolved' && (
              <form onSubmit={saveIssue} className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                <label className="block text-sm font-semibold text-slate-700">Update status
                  <select value={status} onChange={(event) => setStatus(event.target.value as DeliveryIssue['status'])} className="input-shell mt-1">
                    <option value={issue.status}>{formatStatus(issue.status)}</option>
                    {issue.status === 'reported' && <option value="under_review">Under Review</option>}
                    {issue.status === 'open' && <option value="under_review">Under Review</option>}
                    {issue.status === 'under_review' && issue.action_taken === true && actionTaken !== 'no' && <option value="resolved">Resolved</option>}
                  </select>
                </label>
                {issue.status === 'under_review' && status === 'under_review' && (
                  <>
                    <label className="block text-sm font-semibold text-slate-700">Was any action taken?
                      <select value={actionTaken || (issue.action_taken === true ? 'yes' : issue.action_taken === false ? 'no' : '')} onChange={(event) => {
                        const selection = event.target.value as '' | 'yes' | 'no'
                        setActionTaken(selection)
                        if (selection === 'no') setStatus('under_review')
                      }} className="input-shell mt-1">
                        <option value="">Select Yes or No</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                    {actionTaken === 'yes' && (
                      <label className="block text-sm font-semibold text-slate-700">What action was taken?
                        <textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} maxLength={2000} className="input-shell mt-1 min-h-24" />
                      </label>
                    )}
                  </>
                )}
                <button type="submit" disabled={saving || (status === 'resolved' && issue.action_taken !== true) || (status === issue.status && resolutionNote === (issue.resolution_note || '') && (!actionTaken || (actionTaken === 'yes') === issue.action_taken))} className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">
                  {saving ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}{saving ? 'Saving…' : status === 'under_review' && actionTaken ? 'Save action' : 'Save issue update'}
                </button>
              </form>
            )}
          </>
        ) : (
          <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message || 'Delivery issue not found.'}</p>
        )}
        {message && issue && <p role="status" className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
      </section>
    </main>
  )
}

function DeliveryFeedbackDialog({
  taskId,
  initialMode,
  onClose,
  onSubmitted,
}: {
  taskId: string
  initialMode: 'feedback' | 'issue'
  onClose: () => void
  onSubmitted: () => Promise<void>
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'feedback' | 'issue'>(initialMode)
  const [feedback, setFeedback] = useState<FeedbackEntry | null>(null)
  const [issues, setIssues] = useState<DeliveryIssue[]>([])
  const [rating, setRating] = useState('5')
  const [foodCondition, setFoodCondition] = useState('')
  const [deliveryExperience, setDeliveryExperience] = useState('')
  const [comments, setComments] = useState('')
  const [appreciation, setAppreciation] = useState('Thank you for making this delivery possible.')
  const [editing, setEditing] = useState(false)
  const [issueDescription, setIssueDescription] = useState('')
  const [issueCategory, setIssueCategory] = useState('delivery')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    apiRequest(`/delivery-tasks/${encodeURIComponent(taskId)}/feedback`)
      .then((response) => {
        if (!active) return
        setFeedback(response.my_feedback || null)
        setIssues(response.issues || [])
        if (response.my_feedback) {
          setRating(String(response.my_feedback.rating))
          setFoodCondition(response.my_feedback.food_condition_feedback || '')
          setDeliveryExperience(response.my_feedback.delivery_experience_feedback || response.my_feedback.comment || '')
          setComments(response.my_feedback.comments || response.my_feedback.comment || '')
          setAppreciation(response.my_feedback.appreciation_message || '')
        }
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to load delivery feedback')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [taskId])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      if (mode === 'feedback') {
        const response = await apiRequest(
          feedback
            ? `/delivery-feedback/${encodeURIComponent(feedback.id)}`
            : `/delivery-tasks/${encodeURIComponent(taskId)}/feedback`,
          {
          method: feedback ? 'PATCH' : 'POST',
          body: JSON.stringify({
            rating: Number(rating),
            food_condition_feedback: foodCondition,
            delivery_experience_feedback: deliveryExperience,
            comments,
            appreciation_message: appreciation,
          }),
        })
        setFeedback(response.feedback)
        setEditing(false)
        setMessage(feedback ? 'Your delivery feedback was updated.' : 'Thank you. Your delivery feedback was submitted.')
      } else {
        const response = await apiRequest(`/delivery-tasks/${encodeURIComponent(taskId)}/issues`, {
          method: 'POST',
          body: JSON.stringify({ category: issueCategory, description: issueDescription }),
        })
        setIssues((current) => current.some((issue) => issue.id === response.issue.id) ? current : [...current, response.issue])
        setMessage('Your delivery issue was reported to the coordinating organization.')
        await onSubmitted()
        navigate(`/delivery-issues/${encodeURIComponent(response.issue.id)}`)
        return
      }
      await onSubmitted()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit your report')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4" role="presentation">
      <section className="my-auto w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delivery-feedback-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="delivery-feedback-title" className="text-xl font-bold text-slate-900">Delivery feedback</h2>
            <p className="mt-1 text-xs text-slate-500">Delivery ID: {taskId}</p>
          </div>
          <button type="button" onClick={onClose} className="secondary-btn inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold"><X size={16} />Close</button>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setMode('feedback')} className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${mode === 'feedback' ? 'bg-[#1d4d3d] text-white' : 'border border-slate-200 text-slate-700'}`}><Heart size={14} />Give Feedback</button>
          <button type="button" onClick={() => setMode('issue')} className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${mode === 'issue' ? 'bg-[#1d4d3d] text-white' : 'border border-slate-200 text-slate-700'}`}><Flag size={14} />Report an Issue</button>
        </div>
        {loading ? <p className="mt-5 text-sm text-slate-600">Loading delivery feedback…</p> : mode === 'feedback' ? (
          feedback && !editing ? (
            <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="flex items-center gap-2 font-semibold"><BadgeCheck size={17} />Feedback submitted</p>
              <p className="mt-2 flex items-center gap-1" aria-label={`Rating ${feedback.rating} out of 5`}>
                {Array.from({ length: 5 }, (_, index) => <Star key={index} size={16} className={index < feedback.rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'} />)}
                <span className="ml-1">{feedback.rating}/5</span>
              </p>
              <p className="mt-2"><span className="font-medium">Food condition:</span> {feedback.food_condition_feedback || 'Not recorded'}</p>
              <p className="mt-1"><span className="font-medium">Delivery experience:</span> {feedback.delivery_experience_feedback || feedback.comment || 'Not recorded'}</p>
              {feedback.appreciation_message && <p className="mt-1"><span className="font-medium">Appreciation:</span> {feedback.appreciation_message}</p>}
              {(feedback.comments || feedback.comment) && <p className="mt-1"><span className="font-medium">Comments:</span> {feedback.comments || feedback.comment}</p>}
              <button type="button" onClick={() => setEditing(true)} className="secondary-btn mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"><Pencil size={14} />Edit feedback</button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3">
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><Star size={15} className="text-amber-500" />Overall rating</span>
                <select value={rating} onChange={(event) => setRating(event.target.value)} className="input-shell mt-1">
                  {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5 stars</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><Utensils size={15} />Food quality / condition</span>
                <textarea value={foodCondition} onChange={(event) => setFoodCondition(event.target.value)} className="input-shell mt-1 min-h-20" maxLength={2000} required />
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><Truck size={15} />Delivery experience</span>
                <textarea value={deliveryExperience} onChange={(event) => setDeliveryExperience(event.target.value)} className="input-shell mt-1 min-h-20" maxLength={2000} required />
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><Heart size={15} />Appreciation message</span>
                <textarea value={appreciation} onChange={(event) => setAppreciation(event.target.value)} className="input-shell mt-1 min-h-16" maxLength={500} required />
              </label>
              <label className="block text-sm font-semibold text-slate-700"><span className="mb-2 flex items-center gap-2"><MessageCircle size={15} />Optional comments</span>
                <textarea value={comments} onChange={(event) => setComments(event.target.value)} className="input-shell mt-1 min-h-16" maxLength={2000} />
              </label>
              <div className="flex justify-end gap-2">
                {feedback && <button type="button" onClick={() => setEditing(false)} className="secondary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><X size={15} />Cancel edit</button>}
                {!feedback && <button type="button" onClick={onClose} className="secondary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><X size={15} />Cancel</button>}
                <button type="submit" disabled={saving} className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={15} /> : feedback ? <Save size={15} /> : <Send size={15} />}{saving ? 'Saving…' : feedback ? 'Save changes' : 'Submit Feedback'}</button>
              </div>
            </form>
          )
        ) : issues.length ? (
          <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Issue reported · {formatStatus(issues[0].status)}</p>
            <p className="mt-2">{issues[0].description}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block text-sm font-semibold text-slate-700">Issue category
              <select value={issueCategory} onChange={(event) => setIssueCategory(event.target.value)} className="input-shell mt-1">
                <option value="delivery">Delivery</option>
                <option value="food_quality">Food quality</option>
                <option value="quantity">Quantity</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-700">Describe the issue
              <textarea value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} className="input-shell mt-1 min-h-28" maxLength={2000} required />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="secondary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><X size={15} />Cancel</button>
              <button type="submit" disabled={saving} className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={15} /> : <Send size={15} />}{saving ? 'Submitting…' : 'Submit Issue'}</button>
            </div>
          </form>
        )}
        {message && <p role="status" className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
      </section>
    </div>
  )
}

type SessionUser = {
  id: string
  full_name: string
  email: string
  role: Role
  organization_name?: string
  city?: string
  phone?: string
  address?: string
}

type Donation = {
  id: string
  donor_id: string
  donor_organization?: string
  food_name: string
  category: string
  quantity: number
  available_quantity?: number
  quantity_unit: string
  servings: number
  status: string
  city: string
  pickup_location: string
  image_url?: string
  description?: string
  is_veg?: boolean
  image_source?: string
  preparation_time?: string
  available_until?: string
  pickup_available_until?: string
  handling_instructions?: string
  feedback?: FeedbackEntry[]
  created_at?: string
  updated_at?: string
  cancellation_reason?: string
  cancelled_at?: string
  cancellation_eligible?: boolean
}

type PublicDonation = {
  id: string
  food_name: string
  category: string
  description?: string
  quantity: number
  available_quantity: number
  distributed_quantity?: number
  remaining_quantity?: number
  quantity_unit: string
  servings: number
  status: string
  is_requestable?: boolean
  city: string
  image_url?: string
  image_source?: string
  is_veg?: boolean
  preparation_time?: string
  available_until?: string
  pickup_available_until?: string
  created_at?: string
  status_history?: Array<{ status: string; created_at: string }>
}

type PublicDonationSummary = Omit<PublicDonation, 'status_history'>

function publicDonationSummary(donation: PublicDonation): PublicDonationSummary {
  const { status_history: _statusHistory, ...summary } = donation
  return summary
}

type PublicDashboardOverview = {
  stats: {
    total_donations: number
    available_donations: number
    meals_redistributed: number
    fulfilled_requests: number
    connected_organizations: number
    completed_donations: number
    active_donations: number
    meals_redistributed_before_expiry: number
    open_volunteer_opportunities: number
  }
  organizations: Array<{
    organization_name: string
    city: string
  }>
  matches: Array<{
    donation_id: string
    food_name: string
    category: string
    city: string
    available_quantity: number
    quantity_unit: string
    need_id: string
    need_remaining_quantity: number
    organization_name: string
  }>
  volunteers: Array<{
    id: string
    full_name: string
    city: string
    status: string
  }>
  volunteer_opportunities: Array<{
    category: string
    city: string
    created_at: string
  }>
  community_needs: PublicCommunityNeed[]
  alerts: Array<{
    type: string
    message: string
    created_at: string
  }>
}

type DeliveryIssue = {
  id: string
  request_id?: string | null
  donation_id?: string | null
  delivery_id?: string | null
  task_id?: string | null
  reporter_id?: string | null
  receiver_id?: string
  category?: string
  description: string
  status: 'reported' | 'open' | 'under_review' | 'resolved'
  action_taken?: boolean
  resolution_note?: string
  status_history?: Array<{ status: string; changed_by?: string; created_at: string }>
  created_at: string
  updated_at: string
}

type RequestDeliveryTask = {
  id: string
  status: DeliveryTask['status'] | 'cancelled'
  delivered_at?: string | null
  feedback?: FeedbackEntry[]
  feedback_submitted?: boolean
  issues?: DeliveryIssue[]
}

type DonationCancellation = {
  id: string
  donation_id: string
  reason: string
  created_at: string
  updated_at: string
  reassignment_status: string
  coordinating_ngo_id?: string
  request_ids: string[]
  donor_name: string
  donation: Pick<Donation, 'id' | 'food_name' | 'category' | 'quantity' | 'quantity_unit' | 'pickup_location'>
  requests: Array<Pick<RequestItem, 'id' | 'food_name' | 'requested_quantity' | 'quantity_unit' | 'status' | 'coordinating_ngo_id'>>
}

type FoodImageData = Pick<Donation, 'image_url' | 'image_source'> & {
  food_name?: string
  category?: string
  available_until?: string
  pickup_available_until?: string
}

type NotificationItem = {
  id: string
  message: string
  type: string
  link: string
  read_at: string | null
  created_at: string
}

type RequestItem = {
  id: string
  donation_id: string | null
  ngo_id: string
  requester_id?: string
  coordinating_ngo_id?: string
  requested_quantity: number
  quantity_unit?: string
  food_name?: string
  category?: string
  priority?: 'high' | 'medium' | 'low'
  required_date?: string
  required_time?: string
  receiver_name?: string
  receiver_city?: string
  delivery_location?: string
  multi_contribution?: boolean
  contributed_quantity?: number
  delivered_quantity?: number
  remaining_quantity?: number
  remaining_to_deliver_quantity?: number
  donor_available_quantity?: number
  donor_can_fulfill_quantity?: number
  out_of_stock?: boolean
  pending_delivery?: boolean
  contributions?: RequestContribution[]
  purpose: string
  status: string
  created_at: string
  updated_at: string
  status_history?: Array<{ status: string; created_at: string }>
  delivery_tasks?: RequestDeliveryTask[]
  donation?: {
    food_name: string
    category: string
    quantity?: number
    quantity_unit?: string
    status?: string
    donor_name?: string
    donor_organization?: string
    image_url?: string
    image_source?: string
    pickup_location: string
    city: string
    handling_instructions: string
    contact_name: string
    contact_phone: string
    available_until: string
    pickup_available_until?: string
  }
}

type RequestContribution = {
  id: string
  request_id: string
  donor_id: string
  donation_id: string
  quantity: number
  quantity_unit: string
  status: string
  donor_name?: string
  food_name?: string
  category?: string
  image_url?: string
  image_source?: string
  available_until?: string
  pickup_available_until?: string
  pickup_location?: string
  delivery_task_id?: string | null
  delivery_status?: DeliveryTask['status'] | null
  volunteer_name?: string
}

type DeliveryTask = {
  id: string
  request_id: string | null
  donation_id: string | null
  community_need_id?: string
  community_contribution_id?: string
  request_contribution_id?: string
  ngo_id: string
  volunteer_id: string | null
  volunteer_name?: string
  food_name?: string
  category?: string
  image_url?: string
  image_source?: string
  available_until?: string
  pickup_available_until?: string
  quantity?: number | string
  quantity_unit?: string
  pickup_location: string
  pickup_instructions: string
  dropoff_location: string
  dropoff_instructions: string
  status: 'open' | 'assigned' | 'accepted' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled'
  status_history: Array<{ status: string; created_at: string }>
  created_at: string
  updated_at: string
  cancellation_reason?: string
  cancelled_at?: string
  feedback?: FeedbackEntry[]
  issues?: DeliveryIssue[]
  receiver_name?: string
}

type AvailabilityEntry = {
  id: string
  volunteer_id: string
  volunteer_name?: string
  date: string
  status: 'available' | 'unavailable'
  notes?: string
}

type LeaderboardEntry = {
  volunteer_id: string
  name: string
  completed_deliveries: number
  rank: number
}

type FeedbackEntry = {
  id: string
  task_id: string
  donation_id?: string
  volunteer_id: string
  author_id: string
  author_role: 'requester' | 'ngo'
  author_name: string
  rating: number
  comment: string
  delivery_id?: string
  request_id?: string
  receiver_id?: string
  food_condition_feedback?: string
  delivery_experience_feedback?: string
  comments?: string
  appreciation_message?: string
  created_at: string
  updated_at: string
}

type CommunityNeed = {
  id: string
  ngo_id: string
  category: string
  required_quantity: number
  servings: number
  location: string
  city: string
  urgency: string
  required_date: string
  description: string
  status: string
  has_responded?: boolean
  pickup_location?: string
  pickup_location_locked?: boolean
  contributions?: CommunityNeedContribution[]
  delivered_quantity?: number
  created_at: string
  updated_at: string
}

type PublicCommunityNeed = {
  id: string
  category: string
  required_quantity: number
  delivered_quantity?: number
  remaining_quantity?: number
  servings: number
  location: string
  city: string
  urgency: string
  required_date: string
  description: string
  status: string
  organization_name?: string
  created_at?: string
  updated_at?: string
}

type CommunityNeedContribution = {
  id: string
  donor_id: string
  donor_name?: string
  quantity: number
  pickup_location?: string
  status?: 'responded' | 'assigned' | 'delivered'
  delivery_status?: DeliveryTask['status'] | null
  delivery_task_id?: string
  volunteer_id?: string
  volunteer_name?: string
}

type AvailableVolunteer = {
  id: string
  full_name: string
  city: string
}

function uniqueAvailableVolunteers(volunteers: AvailableVolunteer[]): AvailableVolunteer[] {
  const unique = new globalThis.Map<string, AvailableVolunteer>()
  for (const volunteer of volunteers) {
    if (!volunteer.id) continue
    const normalizedName = volunteer.full_name.trim().split(/\s+/).join(' ').toLocaleLowerCase()
    const identityKey = normalizedName || volunteer.id
    if (!unique.has(identityKey)) unique.set(identityKey, volunteer)
  }
  return [...unique.values()]
}

type DashboardSummary = {
  stats: Record<string, number | string>
  recent_activity: Array<Record<string, unknown>>
}

type DonationCertificate = {
  id: string
  certificate_id: string
  donor_id: string
  donor_name: string
  certificate_type?: 'donation' | 'milestone'
  donation_id?: string
  food_name?: string
  category?: string
  quantity?: number
  quantity_unit?: string
  donation_date?: string
  delivery_date?: string
  created_at?: string
  milestone?: 'first_donation' | 'first_delivery' | 'community_hero' | 'food_donation_champion_15' | 'food_donation_champion' | 'humanity_ambassador'
  milestone_name?: string
  title: string
  completed_deliveries?: number
  completed_donations?: number
  achievement_date?: string
  message?: string
}

type DonationMilestoneProgress = {
  key: string
  title: string
  required_donations: number
  completed_donations: number
  remaining_donations: number
  progress_percent: number
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character] || character)
}

function certificateDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

function foodExpiryDateTime(value?: string): string {
  if (!value) return 'Not provided'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
}

type CertificateDocumentData = {
  recipientName: string
  certificateId: string
  achievementTitle: string
  detailLabel: string
  detailValue: string
  supportingDetails: string
  achievementDate: string
  issueDate: string
  message: string
}

function createCertificateDocumentHtml(data: CertificateDocumentData): string {
  const recipientName = escapeXml(data.recipientName || 'Valued recipient')
  const certificateId = escapeXml(data.certificateId)
  const achievementTitle = escapeXml(data.achievementTitle)
  const detailLabel = escapeXml(data.detailLabel)
  const detailValue = escapeXml(data.detailValue)
  const supportingDetails = escapeXml(data.supportingDetails)
  const achievementDate = escapeXml(data.achievementDate)
  const issueDate = escapeXml(data.issueDate)
  const message = escapeXml(data.message)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Certificate of Appreciation · ${recipientName}</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { background: #eeece5; color: #263c32; font-family: "Palatino Linotype", "Book Antiqua", Georgia, serif; }
    .certificate-sheet {
      container-type: inline-size;
      position: relative;
      isolation: isolate;
      display: flex;
      width: 100vw;
      height: 100vh;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      overflow: hidden;
      padding: 3.15cqw 7.2cqw 2.65cqw;
      background: #fbf9f1;
      text-align: center;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .certificate-sheet::before, .certificate-sheet::after {
      position: absolute; z-index: -1; content: ""; pointer-events: none;
    }
    .certificate-sheet::before { inset: 1.55%; border: 1.15cqw solid #164638; }
    .certificate-sheet::after { inset: 2.75%; border: .24cqw solid #b79a5c; }
    .corner { position: absolute; width: 4.4cqw; height: 4.4cqw; border-color: #b79a5c; border-style: solid; }
    .corner-tl { top: 3.1%; left: 3.1%; border-width: .3cqw 0 0 .3cqw; }
    .corner-tr { top: 3.1%; right: 3.1%; border-width: .3cqw .3cqw 0 0; }
    .corner-bl { bottom: 3.1%; left: 3.1%; border-width: 0 0 .3cqw .3cqw; }
    .corner-br { right: 3.1%; bottom: 3.1%; border-width: 0 .3cqw .3cqw 0; }
    .top-block, .main-block, .certificate-footer { width: 100%; }
    .top-block { display: flex; flex-direction: column; align-items: center; gap: .55cqw; }
    .emblem {
      display: grid; width: 6.5cqw; height: 6.5cqw; place-items: center; border: .22cqw solid #b79a5c;
      border-radius: 50%; background: #164638; color: #f7efd9;
      box-shadow: inset 0 0 0 .35cqw #164638, inset 0 0 0 .48cqw #dfc98f;
    }
    .emblem svg { width: 3.6cqw; height: 3.6cqw; }
    .organization { margin: 0; color: #806938; font: 700 1.12cqw/1.2 Arial, sans-serif; letter-spacing: .28cqw; }
    .heading { margin: .55cqw 0 0; color: #164638; font-size: 3.48cqw; font-weight: 600; line-height: 1.04; letter-spacing: .035cqw; }
    .heading-rule { display: flex; width: 48%; align-items: center; gap: 1cqw; margin: .55cqw auto 0; color: #b79a5c; }
    .heading-rule::before, .heading-rule::after { height: .12cqw; flex: 1; background: #b79a5c; content: ""; }
    .heading-rule span { width: .62cqw; height: .62cqw; transform: rotate(45deg); background: #b79a5c; }
    .main-block { display: flex; flex-direction: column; align-items: center; gap: .65cqw; }
    .presented { margin: 0; color: #60685f; font-size: 1.35cqw; }
    .recipient { max-width: 100%; margin: 0; color: #164638; font-size: 4.5cqw; font-weight: 700; line-height: 1.02; overflow-wrap: anywhere; }
    .achievement { margin: .25cqw 0 0; color: #344b3f; font-size: 1.45cqw; font-weight: 600; }
    .detail-label { margin: .2cqw 0 0; color: #856d3a; font: 700 1.02cqw/1.2 Arial, sans-serif; letter-spacing: .2cqw; text-transform: uppercase; }
    .detail-value { max-width: 85%; margin: 0; color: #164638; font-size: 2.15cqw; font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
    .supporting { margin: 0; color: #60685f; font: 1.1cqw/1.3 Arial, sans-serif; }
    .message { max-width: 79%; margin: .25cqw 0 0; color: #4f5b51; font-size: 1.2cqw; line-height: 1.45; }
    .certificate-footer { display: grid; grid-template-columns: 1fr 1fr; align-items: end; gap: 4cqw; text-align: left; }
    .signature { width: 57%; min-width: 20cqw; text-align: center; }
    .signature-mark { display: block; width: 9cqw; height: 2.2cqw; margin: 0 auto -.15cqw; }
    .signature-line { height: .1cqw; background: #697368; }
    .signature-name { margin: .45cqw 0 0; color: #344b3f; font-size: 1.22cqw; font-style: italic; }
    .signature-label { margin: .2cqw 0 0; color: #777b71; font: 700 .78cqw/1.2 Arial, sans-serif; letter-spacing: .16cqw; }
    .issued { justify-self: end; color: #667067; font: .82cqw/1.55 Arial, sans-serif; text-align: right; }
    .issued p { margin: .12cqw 0; }
    .issued strong { color: #405448; font-weight: 700; letter-spacing: .04cqw; }
    @media print {
      html, body { width: 297mm; height: 210mm; background: #fbf9f1; }
      .certificate-sheet { width: 297mm; height: 210mm; }
    }
  </style>
</head>
<body>
  <main class="certificate-sheet" aria-label="Certificate of Appreciation for ${recipientName}">
    <i class="corner corner-tl"></i><i class="corner corner-tr"></i><i class="corner corner-bl"></i><i class="corner corner-br"></i>
    <header class="top-block">
      <div class="emblem" aria-label="Food and community emblem">
        <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path d="M12 38c9-8 31-8 40 0v10H12V38Z" fill="#D8BD7E"/>
          <path d="M16 37c9-6 23-6 32 0M24 32c-6-8-4-16 2-20 6 6 7 12 4 19M33 31c-2-11 2-19 9-22 4 8 2 15-3 23M41 34c2-8 8-12 15-11 0 7-4 12-12 15" stroke="#F7EFD9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20 53h24" stroke="#D8BD7E" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <p class="organization">SMART FOOD DONATION AND REDISTRIBUTION SYSTEM</p>
      <h1 class="heading">Certificate of Appreciation</h1>
      <div class="heading-rule"><span></span></div>
    </header>
    <section class="main-block">
      <p class="presented">Presented with gratitude to</p>
      <h2 class="recipient">${recipientName}</h2>
      <p class="achievement">${achievementTitle}</p>
      <p class="detail-label">${detailLabel}</p>
      <p class="detail-value">${detailValue}</p>
      <p class="supporting">${supportingDetails}</p>
      <p class="message">${message}</p>
    </section>
    <footer class="certificate-footer">
      <div class="signature">
        <svg class="signature-mark" viewBox="0 0 180 42" fill="none" aria-hidden="true"><path d="M6 31c13-20 15 6 27-4s12-19 17-9c5 11 8 13 18-5 8-14 11 28 23 12 8-10 11-12 16-5 6 9 13-5 19-11 5-4 9 0 10 7 1 8 7 9 17-2" stroke="#315345" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="signature-line"></div>
        <p class="signature-name">Project Coordinator</p>
        <p class="signature-label">AUTHORIZED SIGNATURE</p>
      </div>
      <div class="issued">
        <p><strong>ACHIEVEMENT DATE</strong> · ${achievementDate}</p>
        <p><strong>ISSUE DATE</strong> · ${issueDate}</p>
        <p><strong>CERTIFICATE ID</strong> · ${certificateId}</p>
      </div>
    </footer>
  </main>
</body>
</html>`
}

function isDonorCertificate(certificate: DonationCertificate): boolean {
  return certificate.certificate_type === 'donation'
    || certificate.certificate_type === 'milestone'
    || Boolean(certificate.donation_id || certificate.milestone)
}

function createDonationCertificateHtml(
  certificate: DonationCertificate,
  milestoneDonation?: DonationCertificate,
): string {
  const isMilestone = certificate.certificate_type === 'milestone' || Boolean(certificate.milestone)
  const donation = milestoneDonation || certificate
  const quantity = `${donation.quantity ?? 0} ${donation.quantity_unit || ''}`.trim()
  const completedDonations = Number(certificate.completed_donations ?? certificate.completed_deliveries ?? 0)
  return createCertificateDocumentHtml({
    recipientName: certificate.donor_name,
    certificateId: certificate.certificate_id,
    achievementTitle: isMilestone
      ? certificate.milestone_name || certificate.title
      : 'In recognition of your completed food donation',
    detailLabel: isMilestone ? 'DONATION MILESTONE' : 'FOOD CONTRIBUTED',
    detailValue: isMilestone
      ? `${completedDonations} completed donation${completedDonations === 1 ? '' : 's'}`
      : certificate.food_name || 'Food donation',
    supportingDetails: isMilestone
      ? `Achievement donation: ${donation.food_name || 'Food donation'} · Quantity: ${quantity} · Category: ${donation.category || 'Food'}`
      : `Quantity: ${quantity} · Category: ${donation.category || 'Food'}`,
    achievementDate: certificateDate(
      certificate.achievement_date || certificate.delivery_date || certificate.donation_date || '',
    ),
    issueDate: certificateDate(certificate.created_at || certificate.delivery_date || ''),
    message: certificate.message || 'Your generosity helped reduce food waste and brought nourishment and care to people in need.',
  })
}

function pickupDeadlineDateTime(value?: string): string {
  return value ? foodExpiryDateTime(value) : 'Pickup deadline not specified.'
}

function requestPriorityClass(priority?: string): string {
  if (priority === 'high') return 'bg-[#fef3c7] text-[#92400e]'
  if (priority === 'low') return 'bg-slate-100 text-slate-600'
  return priority === 'medium' ? 'bg-[#ecfdf5] text-[#1d4d3d]' : 'bg-slate-100 text-slate-500'
}

function requiredDateTimeLabel(requiredDate?: string, requiredTime?: string): string {
  if (!requiredDate || !requiredTime) return 'Not specified'
  const date = new Date(`${requiredDate}T${requiredTime}`)
  if (Number.isNaN(date.getTime())) return 'Not specified'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function createVolunteerCertificateHtml(volunteerName: string, completedDeliveries: number, issueDate: string, certificateId: string): string {
  return createCertificateDocumentHtml({
    recipientName: volunteerName,
    certificateId,
    achievementTitle: 'For dedicated service to community food redistribution',
    detailLabel: 'Successfully completed deliveries',
    detailValue: completedDeliveries.toLocaleString(),
    supportingDetails: 'Community Food Redistribution Project',
    achievementDate: issueDate,
    issueDate,
    message: 'With gratitude for carrying nourishing food to neighbors and strengthening our community through dependable service.',
  })
}

function createUniqueCertificateId(prefix: 'VOL'): string {
  const uniquePart = globalThis.crypto?.randomUUID?.().replaceAll('-', '').toUpperCase()
    || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.toUpperCase()
  return `SFDRS-${prefix}-${uniquePart}`
}

function openCertificatePrintWindow(html: string, title: string): boolean {
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.opener = null
    printWindow.addEventListener('load', () => {
      printWindow.requestAnimationFrame(() => printWindow.print())
    }, { once: true })
    printWindow.document.open()
    printWindow.document.write(html.replace('<title>', `<title>${escapeXml(title)} · `))
    printWindow.document.close()
    return true
  }

  const printFrame = document.createElement('iframe')
  printFrame.setAttribute('aria-hidden', 'true')
  printFrame.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0'
  printFrame.srcdoc = html
  printFrame.onload = () => {
    const frameWindow = printFrame.contentWindow
    if (!frameWindow) {
      printFrame.remove()
      return
    }
    frameWindow.addEventListener('afterprint', () => printFrame.remove(), { once: true })
    frameWindow.focus()
    frameWindow.print()
  }
  document.body.appendChild(printFrame)
  return true
}

function createDonationCertificateSvg(certificate: DonationCertificate): string {
  const donorName = escapeXml(certificate.donor_name || 'Valued donor')
  const foodName = escapeXml(certificate.food_name || 'Food donation')
  const categoryLabel = escapeXml((certificate.category || 'Food').toLocaleUpperCase())
  const quantity = escapeXml(`${certificate.quantity ?? 0} ${certificate.quantity_unit || ''}`.trim())
  const donationDate = escapeXml(certificateDate(certificate.donation_date || ''))
  const issueDate = escapeXml(certificateDate(certificate.created_at || certificate.delivery_date || ''))
  const certificateId = escapeXml(certificate.certificate_id)
  const nameLength = Math.min(980, Math.max(430, donorName.length * 30))
  const foodLength = Math.min(800, Math.max(300, foodName.length * 28))
  const message = escapeXml(certificate.message || 'Your generous donation helped reduce food waste and bring nourishment and care to people in need.')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="990" viewBox="0 0 1400 990" role="img" aria-label="Certificate of Appreciation for ${donorName}, recognizing a donation of ${foodName}">
    <defs>
      <linearGradient id="donation-paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf7"/><stop offset=".52" stop-color="#fbf7eb"/><stop offset="1" stop-color="#f5eedc"/></linearGradient>
      <linearGradient id="donation-seal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9bd79"/><stop offset=".52" stop-color="#b79854"/><stop offset="1" stop-color="#8d6e35"/></linearGradient>
      <pattern id="donation-grain" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0 28L28 0" stroke="#8f6b32" stroke-opacity=".025" stroke-width="1"/></pattern>
    </defs>
    <rect width="1400" height="990" fill="url(#donation-paper)"/><rect width="1400" height="990" fill="url(#donation-grain)"/>
    <rect x="22" y="22" width="1356" height="946" fill="none" stroke="#164638" stroke-width="6"/>
    <rect x="39" y="39" width="1322" height="912" fill="none" stroke="#b89a57" stroke-width="2"/>
    <rect x="52" y="52" width="1296" height="886" fill="none" stroke="#164638" stroke-opacity=".42" stroke-width="1"/>
    <path d="M62 166V62h104M1234 62h104v104M62 824v104h104M1234 928h104V824" fill="none" stroke="#b89a57" stroke-width="5"/>
    <g transform="translate(700 130)">
      <circle r="43" fill="#164638"/>
      <circle r="37" fill="none" stroke="#d8bd7e" stroke-width="1.5"/>
      <path d="M-21 7q21-16 42 0v14h-42z" fill="#d8bd7e" stroke="#f7edd3" stroke-width="1.5"/>
      <path d="M-18 4q18-13 36 0M-11 0q-7-13 2-22 10 9 5 20M0-1q-4-17 7-25 10 11 3 25M11 1q0-14 12-18 5 12-5 21" fill="none" stroke="#f7edd3" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M-29 27h58" stroke="#d8bd7e" stroke-width="1"/>
    </g>
    <text x="700" y="207" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" letter-spacing="4" font-weight="700" fill="#866b37">SMART FOOD DONATION AND REDISTRIBUTION SYSTEM</text>
    <text x="700" y="287" text-anchor="middle" font-family="Georgia,serif" font-size="57" letter-spacing="1.5" font-weight="700" fill="#164638">Certificate of Appreciation</text>
    <path d="M304 316h792" stroke="#b89a57" stroke-width="2"/>
    <path d="M555 316l15-8 15 8-15 8z" fill="#b89a57"/>
    <text x="700" y="365" text-anchor="middle" font-family="Georgia,serif" font-size="23" font-style="italic" fill="#5b6258">Presented with gratitude to</text>
    <text x="700" y="445" text-anchor="middle" textLength="${nameLength}" lengthAdjust="spacingAndGlyphs" font-family="Georgia,serif" font-size="62" font-weight="700" fill="#164638">${donorName}</text>
    <path d="M410 468h580" stroke="#164638" stroke-opacity=".25" stroke-width="1.5"/>
    <text x="700" y="516" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" fill="#48564d">In recognition of your generous contribution of</text>
    <text x="700" y="578" text-anchor="middle" textLength="${foodLength}" lengthAdjust="spacingAndGlyphs" font-family="Georgia,serif" font-size="42" font-weight="700" fill="#203f34">${foodName}</text>
    <text x="700" y="612" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" letter-spacing="2" font-weight="700" fill="#8a7041">${categoryLabel}</text>
    <rect x="388" y="642" width="280" height="82" rx="4" fill="#f3eddf" stroke="#d8c89f" stroke-width="1.5"/>
    <rect x="732" y="642" width="280" height="82" rx="4" fill="#f3eddf" stroke="#d8c89f" stroke-width="1.5"/>
    <text x="528" y="671" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="2" font-weight="700" fill="#866b37">QUANTITY DONATED</text>
    <text x="528" y="706" text-anchor="middle" font-family="Georgia,serif" font-size="27" font-weight="700" fill="#164638">${quantity}</text>
    <text x="872" y="671" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="2" font-weight="700" fill="#866b37">DONATION DATE</text>
    <text x="872" y="706" text-anchor="middle" font-family="Georgia,serif" font-size="21" font-weight="700" fill="#164638">${donationDate}</text>
    <text x="700" y="772" text-anchor="middle" font-family="Georgia,serif" font-size="19" fill="#4a574d">${message}</text>
    <g transform="translate(350 855)">
      <path d="M0 0h250" stroke="#53655a" stroke-width="1.5"/>
      <path d="M18-13q13-19 25-2 11-28 25-3 14-18 25-2 14-17 27 1" fill="none" stroke="#315345" stroke-width="2.2" stroke-linecap="round"/>
      <text x="125" y="29" text-anchor="middle" font-family="Georgia,serif" font-size="20" font-style="italic" fill="#34483c">Project Coordinator</text>
      <text x="125" y="51" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" letter-spacing="2" fill="#667168">AUTHORIZED SIGNATURE</text>
    </g>
    <g transform="translate(1050 835)">
      <circle r="67" fill="url(#donation-seal)" stroke="#765a2b" stroke-width="3"/>
      <circle r="57" fill="none" stroke="#f9f0d9" stroke-width="2"/>
      <circle r="49" fill="none" stroke="#f9f0d9" stroke-opacity=".7" stroke-width="1"/>
      <path d="M-22 9q22-18 44 0v16h-44z" fill="none" stroke="#fff7e4" stroke-width="2"/>
      <path d="M-16 3q-7-13 2-24 10 9 5 21M0 1q-4-17 7-25 10 11 3 25M14 4q0-13 11-17 5 11-5 20" fill="none" stroke="#fff7e4" stroke-width="2.5" stroke-linecap="round"/>
      <text y="39" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" letter-spacing="1.4" font-weight="700" fill="#fff7e4">SERVICE • DIGNITY</text>
    </g>
    <text x="700" y="925" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="1.2" fill="#667168">ISSUED ${issueDate}  ·  CERTIFICATE ID ${certificateId}</text>
  </svg>`
}

function createCertificateSvg(certificate: DonationCertificate): string {
  if (certificate.certificate_type !== 'milestone' && !certificate.milestone) {
    return createDonationCertificateSvg(certificate)
  }
  const designs = {
    first_donation: {
      background: '#fff8ee',
      accent: '#b45309',
      pale: '#ffedd5',
      label: 'FIRST DONATION',
      message: 'Your first completed food donation helped reduce waste and bring nourishment to someone in need.',
      badge: '1',
    },
    community_hero: {
      background: '#f3f6fa',
      accent: '#475569',
      pale: '#dbe4ee',
      label: 'COMMUNITY HERO',
      message: 'Five completed food donations show a generous commitment to nourishing and supporting your community.',
      badge: '5',
    },
    food_donation_champion_15: {
      background: '#fffbea',
      accent: '#a16207',
      pale: '#fef08a',
      label: 'FOOD DONATION CHAMPION',
      message: 'Fifteen completed food donations make you a champion of food redistribution and community care.',
      badge: '15',
    },
    humanity_ambassador: {
      background: '#f3f0e6',
      accent: '#1d473c',
      pale: '#d8bf77',
      label: 'HUMANITY AMBASSADOR',
      message: 'Twenty-five completed food donations are a lasting contribution to dignity, nourishment, and hope.',
      badge: '25',
    },
  } as const
  const legacyMilestone = certificate.milestone || 'first_donation'
  const milestone = legacyMilestone === 'first_delivery'
    ? 'first_donation'
    : legacyMilestone === 'food_donation_champion'
      ? 'food_donation_champion_15'
      : legacyMilestone
  const design = designs[milestone]
  const milestoneName = escapeXml(certificate.milestone_name || 'Donation Achievement')
  const title = escapeXml(certificate.title)
  const donorName = escapeXml(certificate.donor_name || 'Valued donor')
  const date = escapeXml(certificateDate(certificate.achievement_date || ''))
  const certificateId = escapeXml(certificate.certificate_id)
  const message = escapeXml(design.message)
  const completedDonations = certificate.completed_donations ?? certificate.completed_deliveries ?? 0
  const ordinal = completedDonations === 1 ? '1ST' : completedDonations === 5 ? '5TH' : completedDonations === 15 ? '15TH' : '25TH'
  const mainCenter = milestone === 'community_hero' ? 680 : 600
  const donorNameLength = Math.min(milestone === 'community_hero' ? 580 : 700, Math.max(280, donorName.length * 27))
  const milestoneOrnament = milestone === 'first_donation'
    ? `<circle cx="130" cy="410" r="114" fill="${design.pale}" opacity=".45"/><circle cx="130" cy="410" r="79" fill="none" stroke="${design.accent}" stroke-opacity=".2" stroke-width="3"/><path d="M130 290v-30m0 300v-30M10 410h-30m300 0h-30M46 326l-22-22m212 212-22-22m0-168 22-22M46 494l-22 22" stroke="${design.accent}" stroke-opacity=".32" stroke-width="7" stroke-linecap="round"/>`
    : milestone === 'community_hero'
      ? `<rect x="70" y="198" width="220" height="478" rx="18" fill="#e4eaf0" stroke="${design.accent}" stroke-opacity=".35" stroke-width="2"/><path d="M92 228h176M92 646h176" stroke="${design.accent}" stroke-opacity=".3" stroke-width="2"/><circle cx="130" cy="340" r="24" fill="${design.accent}"/><circle cx="185" cy="324" r="29" fill="${design.accent}" opacity=".83"/><circle cx="236" cy="340" r="24" fill="${design.accent}" opacity=".68"/><path d="M94 420q5-62 36-62t36 62M143 420q4-74 42-74t42 74M202 420q4-62 34-62t34 62" fill="${design.accent}"/><path d="M115 451q70 24 140 0l-12 24H127z" fill="${design.accent}"/><path d="M137 450q-9-15 3-30 12 12 7 27M176 448q-5-21 10-32 10 16 2 31M213 450q-4-17 10-26 8 13 1 25" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/><text x="180" y="525" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="2" fill="${design.accent}">TOGETHER</text><text x="180" y="552" text-anchor="middle" font-family="Georgia,serif" font-size="18" font-style="italic" fill="${design.accent}">we nourish</text><text x="180" y="578" text-anchor="middle" font-family="Georgia,serif" font-size="18" font-style="italic" fill="${design.accent}">our community</text>`
      : milestone === 'humanity_ambassador'
        ? `<path d="M90 185h1020v470H90z" fill="none" stroke="${design.accent}" stroke-opacity=".18" stroke-width="2"/><path d="M600 116l16 34 38 5-27 26 7 38-34-18-34 18 7-38-27-26 38-5zM119 672l11 23 25 3-18 17 4 25-22-12-22 12 4-25-18-17 25-3zM1081 672l11 23 25 3-18 17 4 25-22-12-22 12 4-25-18-17 25-3z" fill="${design.pale}" stroke="${design.accent}" stroke-width="2"/><path d="M116 240q95-75 190 0M894 240q95-75 190 0M116 608q95 75 190 0M894 608q95 75 190 0" fill="none" stroke="${design.accent}" stroke-opacity=".45" stroke-width="4"/>`
        : `<path d="M95 246l14 30 33 5-24 23 6 33-29-16-29 16 6-33-24-23 33-5zM1092 426l11 23 25 4-18 17 4 25-22-12-22 12 4-25-18-17 25-4zM116 573l9 18 20 3-14 14 3 20-18-9-18 9 4-20-15-14 20-3z" fill="${design.pale}" stroke="${design.accent}" stroke-opacity=".45" stroke-width="2"/><path d="M180 190q420-145 840 0" fill="none" stroke="${design.accent}" stroke-opacity=".12" stroke-width="2" stroke-dasharray="8 12"/>`
  const medalShape = milestone === 'first_donation'
    ? `<circle r="62" fill="url(#medal)" stroke="${design.accent}" stroke-width="3"/><circle r="49" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="2"/>`
    : milestone === 'community_hero'
      ? `<path d="M0-68 58-34 58 27 0 65-58 27-58-34z" fill="url(#medal)" stroke="${design.accent}" stroke-width="4"/><path d="M0-53 44-27 44 21 0 51-44 21-44-27z" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="2"/>`
      : milestone === 'humanity_ambassador'
        ? `<path d="M0-87 25-62 61-68 67-32 96-10 76 20 80 57 43 68 25 100 0 78-25 100-43 68-80 57-76 20-96-10-67-32-61-68-25-62z" fill="url(#medal)" stroke="${design.accent}" stroke-width="5"/><circle r="58" fill="none" stroke="#fff8dd" stroke-width="3"/><circle r="47" fill="none" stroke="#fff8dd" stroke-opacity=".7" stroke-width="1.5"/>`
        : `<path d="M0-76 19-51 49-57 49-27 76-12 60 13 70 43 40 51 28 80 0 64-28 80-40 51-70 43-60 13-76-12-49-27-49-57-19-51z" fill="url(#medal)" stroke="${design.accent}" stroke-width="4"/><circle r="48" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="2"/>`
  const medalRibbon = milestone === 'first_donation'
    ? `<path d="M-39 47l-12 58 36-20 36 20-12-58" fill="${design.accent}" opacity=".82"/>`
    : milestone === 'community_hero'
      ? `<path d="M-39 49l-4 63 43-23 43 23-4-63" fill="${design.accent}" opacity=".86"/>`
      : milestone === 'humanity_ambassador'
        ? `<path d="M-43 62l-18 91 61-32 61 32-18-91" fill="${design.accent}" opacity=".96"/><path d="M-29 69l-8 64 37-19 37 19-8-64" fill="none" stroke="#fff8dd" stroke-width="2"/>`
        : `<path d="M-34 55l-22 72 56-27 56 27-22-72" fill="${design.accent}" opacity=".9"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="840" viewBox="0 0 1200 840" role="img" aria-label="${title} certificate for ${donorName}">
    <defs>
      <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${design.background}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
      <linearGradient id="medal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${design.pale}"/><stop offset="1" stop-color="${design.accent}"/></linearGradient>
    </defs>
    <rect width="1200" height="840" fill="url(#paper)"/>
    ${milestoneOrnament}
    <rect x="24" y="24" width="1152" height="792" rx="24" fill="none" stroke="${design.accent}" stroke-width="4"/>
    <rect x="42" y="42" width="1116" height="756" rx="18" fill="none" stroke="${design.accent}" stroke-opacity=".35" stroke-width="2"/>
    <path d="M65 115h165M970 115h165M65 725h165M970 725h165" stroke="${design.accent}" stroke-width="3" stroke-linecap="round" opacity=".42"/>
    <circle cx="74" cy="74" r="10" fill="${design.accent}"/><circle cx="1126" cy="74" r="10" fill="${design.accent}"/>
    <circle cx="74" cy="766" r="10" fill="${design.accent}"/><circle cx="1126" cy="766" r="10" fill="${design.accent}"/>
    <text x="600" y="98" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" font-weight="700" letter-spacing="4" fill="${design.accent}">SMART FOOD DONATION AND REDISTRIBUTION SYSTEM</text>
    <text x="${mainCenter}" y="168" text-anchor="middle" font-family="Georgia,serif" font-size="26" letter-spacing="5" fill="${design.accent}">${milestoneName.toUpperCase()}</text>
    <text x="${mainCenter}" y="226" text-anchor="middle" font-family="Georgia,serif" font-size="47" font-weight="700" fill="#172b24">Certificate of Achievement</text>
    <text x="${mainCenter}" y="276" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#475569">Proudly presented to</text>
    <text x="${mainCenter}" y="350" text-anchor="middle" textLength="${donorNameLength}" lengthAdjust="spacingAndGlyphs" font-family="Georgia,serif" font-size="54" font-weight="700" fill="${design.accent}">${donorName}</text>
    <path d="M${mainCenter - 215} 372h430" stroke="${design.accent}" stroke-width="2" opacity=".55"/>
    <text x="${mainCenter}" y="420" text-anchor="middle" font-family="Arial,sans-serif" font-size="21" fill="#334155">In recognition of completing</text>
    <text x="${mainCenter}" y="463" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#172b24">${completedDonations} completed food ${completedDonations === 1 ? 'donation' : 'donations'}</text>
    <text x="${mainCenter}" y="506" text-anchor="middle" font-family="Georgia,serif" font-size="28" font-style="italic" font-weight="700" fill="${design.accent}">${title}</text>
    <text x="${mainCenter}" y="550" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" fill="#475569">${message}</text>
    <g transform="translate(600 644)">
      ${medalShape}
      ${medalRibbon}
      <text y="11" text-anchor="middle" font-family="Georgia,serif" font-size="42" font-weight="700" fill="#ffffff">${design.badge}</text>
      <text y="31" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="1" fill="#ffffff">${ordinal}</text>
    </g>
    <g transform="translate(936 570)" fill="none" stroke="${design.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="-32" cy="-13" r="18" fill="${design.pale}"/><circle cx="44" cy="-13" r="18" fill="${design.pale}"/>
      <path d="M-61 53q4-45 29-45t29 45M15 53q4-45 29-45t29 45"/>
      <path d="M-42 60q12 12 24 0h36q12 12 24 0" />
      <path d="M-54 72h108q-4 36-54 36t-54-36z" fill="${design.pale}"/>
      <path d="M-18 65q-4-17 4-26M0 65q-4-20 4-30M18 65q-2-14 5-22"/>
    </g>
    <text x="115" y="690" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#334155">ACHIEVED</text>
    <text x="115" y="718" font-family="Arial,sans-serif" font-size="17" fill="#475569">${date}</text>
    <text x="115" y="764" font-family="Arial,sans-serif" font-size="13" fill="#64748b">Certificate ID: ${certificateId}</text>
    <path d="M850 702h230" stroke="${design.accent}" stroke-width="1.5"/>
    <text x="965" y="731" text-anchor="middle" font-family="Georgia,serif" font-size="20" font-style="italic" fill="#334155">Platform Coordinator</text>
    <text x="965" y="760" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" letter-spacing="1" fill="#64748b">SMART FOOD REDISTRIBUTION</text>
  </svg>`
}

function certificateDataUrl(certificate: DonationCertificate): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(createCertificateSvg(certificate))}`
}

async function createCertificatePdf(svgMarkup: string): Promise<Blob> {
  const svg = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svg)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Your browser could not decode the certificate artwork.'))
      image.src = svgUrl
    })
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * 2.5)
  canvas.height = Math.round(image.naturalHeight * 2.5)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Your browser could not prepare the certificate for download.')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const jpeg = await new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Your browser could not create the certificate PDF image.'))
        return
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, 'image/jpeg', 0.98)
  })
  const encoder = new TextEncoder()
  const ascii = (value: string) => encoder.encode(value)
  const concatenate = (...parts: Uint8Array[]) => {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let position = 0
    for (const part of parts) {
      result.set(part, position)
      position += part.length
    }
    return result
  }
  const objects: Uint8Array[] = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Certificate 4 0 R >> >> /Contents 5 0 R >>'),
    concatenate(
      ascii(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      ascii('\nendstream'),
    ),
    (() => {
      const content = ascii('q 841.89 0 0 595.28 0 0 cm /Certificate Do Q')
      return concatenate(ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('\nendstream'))
    })(),
  ]
  const chunks: Uint8Array[] = [ascii('%PDF-1.4\n')]
  const offsets: number[] = [0]
  let length = chunks[0].length
  objects.forEach((object, index) => {
    offsets.push(length)
    const wrapped = concatenate(ascii(`${index + 1} 0 obj\n`), object, ascii('\nendobj\n'))
    chunks.push(wrapped)
    length += wrapped.length
  })
  const xrefOffset = length
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ].join('')
  chunks.push(ascii(xref))
  const pdfBuffer = new ArrayBuffer(length + ascii(xref).length)
  const pdfView = new Uint8Array(pdfBuffer)
  let offset = 0
  for (const chunk of chunks) {
    pdfView.set(chunk, offset)
    offset += chunk.length
  }
  return new Blob([pdfBuffer], { type: 'application/pdf' })
}

const configuredApiBase = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')
const API_BASE = configuredApiBase
  ? (/\/api$/i.test(configuredApiBase) ? configuredApiBase : `${configuredApiBase}/api`)
  : '/api'
const MAX_IMAGE_UPLOAD_BYTES = 16 * 1024 * 1024

async function requestCertificateDownload(certificateId: string, pdf: Blob): Promise<void> {
  const token = localStorage.getItem('smart_food_token')
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const formData = new FormData()
  formData.append('certificate_id', certificateId)
  formData.append('certificate_pdf', pdf, `${certificateId}.pdf`)

  let response: Response
  try {
    response = await fetch(`${API_BASE}/certificates/download`, {
      method: 'POST',
      headers,
      body: formData,
    })
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Could not reach the backend to download the certificate.${reason}`)
  }

  if (!response.ok) {
    const responseText = await response.text()
    let message = `Certificate download failed (HTTP ${response.status}).`
    if (responseText) {
      try {
        const body: { error?: string } = JSON.parse(responseText)
        message = body.error || message
      } catch {
        message = `Certificate download failed with an unreadable response (HTTP ${response.status}).`
      }
    }
    throw new Error(message)
  }

  const downloadedPdf = await response.blob()
  if (downloadedPdf.type !== 'application/pdf') {
    throw new Error('The backend did not return a PDF certificate.')
  }
  const url = URL.createObjectURL(downloadedPdf)
  const link = document.createElement('a')
  link.href = url
  link.download = `${certificateId}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function requestVolunteerCertificateDownload(
  certificate: { certificate_id: string; recipient_name: string; completed_deliveries: number; issue_date: string },
): Promise<void> {
  const token = localStorage.getItem('smart_food_token')
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${API_BASE}/certificates/download`, {
      method: 'POST',
      headers,
      body: JSON.stringify(certificate),
    })
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Could not reach the backend to download the certificate.${reason}`)
  }

  if (!response.ok) {
    const responseText = await response.text()
    let message = `Certificate download failed (HTTP ${response.status}).`
    if (responseText) {
      try {
        const body: { error?: string } = JSON.parse(responseText)
        message = body.error || message
      } catch {
        message = `Certificate download failed with an unreadable response (HTTP ${response.status}).`
      }
    }
    throw new Error(message)
  }

  const downloadedPdf = await response.blob()
  if (downloadedPdf.type !== 'application/pdf') {
    throw new Error('The backend did not return a PDF certificate.')
  }
  const url = URL.createObjectURL(downloadedPdf)
  const link = document.createElement('a')
  link.href = url
  link.download = `${certificate.certificate_id}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function isDonorUploadedImage(donation: Pick<Donation, 'image_url' | 'image_source'>): boolean {
  return donation.image_source === 'uploaded'
    || ((donation.image_source === 'legacy' || !donation.image_source)
      && Boolean(donation.image_url?.startsWith('/uploads/'))
      && !donation.image_url?.startsWith('/uploads/ai-food-'))
}

function getDonationImage(donation: FoodImageData): string {
  if (donation.image_url) {
    if (donation.image_url.startsWith('/uploads/')) {
      return `${API_BASE.replace('/api', '')}${donation.image_url}`
    }
    return donation.image_url
  }
  return ''
}

const foodImageSearchCache = new Map<string, Promise<string | null>>()

function isFoodProviderImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const imageUrl = new URL(value)
    return imageUrl.protocol === 'https:'
      && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(imageUrl.hostname)
  } catch {
    return false
  }
}

function searchFoodImage(foodName: string): Promise<string | null> {
  const normalizedName = foodName.trim().toLocaleLowerCase()
  if (!normalizedName) return Promise.resolve(null)

  const cachedResult = foodImageSearchCache.get(normalizedName)
  if (cachedResult) return cachedResult

  const result = apiRequest(`/food-image?food_name=${encodeURIComponent(foodName.trim())}`)
    .then((response) => isFoodProviderImageUrl(response.image_url) ? response.image_url : null)
    .catch(() => null)
    .then((imageUrl) => {
      if (!imageUrl) foodImageSearchCache.delete(normalizedName)
      return imageUrl
    })
  foodImageSearchCache.set(normalizedName, result)
  return result
}

function DonationImage({ donation, className }: { donation: FoodImageData; className: string }) {
  const foodName = donation.food_name || ''
  const isDonorUpload = isDonorUploadedImage(donation)
  const storedImage = getDonationImage(donation)
  const [searchedImage, setSearchedImage] = useState<{ foodName: string; imageUrl: string | null }>({ foodName: '', imageUrl: null })
  const [failedImageSource, setFailedImageSource] = useState('')
  useEffect(() => {
    let active = true
    if (isDonorUpload || storedImage || !foodName.trim()) {
      setSearchedImage({ foodName, imageUrl: null })
      return () => { active = false }
    }

    const timeoutId = window.setTimeout(() => {
      void searchFoodImage(foodName).then((imageUrl) => {
        if (active) setSearchedImage({ foodName, imageUrl })
      })
    }, 400)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [foodName, isDonorUpload, storedImage])

  const imageSource = isDonorUpload
    ? storedImage
    : searchedImage.foodName === foodName
      ? searchedImage.imageUrl || storedImage
      : storedImage
  const displayedImage = imageSource && failedImageSource !== imageSource
    ? imageSource
    : ''

  return displayedImage ? (
    <span className={`relative inline-flex overflow-hidden ${className.replace(/\bobject-cover\b/g, '')}`}>
      <img
        src={displayedImage}
        alt={foodName || 'Food donation'}
        className="h-full w-full object-cover"
        onError={() => setFailedImageSource(displayedImage)}
      />
      {displayedImage === imageSource && isDonorUpload && (
        <span className="absolute inset-x-0 bottom-0 bg-slate-950/75 px-1.5 py-1 text-center text-[10px] font-semibold leading-tight text-white">
          Donor-uploaded photo
        </span>
      )}
    </span>
  ) : (
    <div className={`${className} flex items-center justify-center bg-white px-2 text-center text-xs text-slate-500`} role="img" aria-label={`${foodName}: Food image unavailable`}>
      Food image unavailable
    </div>
  )
}

function formatStatus(value: string): string {
  return (value || 'pending').replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function statusToneClass(value: string): string {
  switch ((value || 'pending').toLowerCase()) {
    case 'expired':
    case 'cancelled':
    case 'rejected':
      return 'bg-red-100 text-red-800'
    case 'completed':
    case 'fulfilled':
    case 'delivered':
      return 'bg-green-100 text-green-800'
    case 'available':
    case 'accepted':
    case 'partial':
    case 'partially_fulfilled':
      return 'bg-emerald-100 text-emerald-800'
    case 'pending':
    case 'under_review':
    case 'pending_delivery':
    case 'requested':
      return 'bg-orange-100 text-orange-800'
    default:
      return 'bg-blue-100 text-blue-800'
  }
}

function expiryToneClass(value?: string): string {
  if (!value) return 'text-slate-600'
  const expiryTime = new Date(value).getTime()
  if (Number.isNaN(expiryTime)) return 'text-slate-600'
  if (expiryTime <= Date.now()) return 'text-red-800'
  if (expiryTime - Date.now() <= 24 * 60 * 60 * 1000) return 'text-amber-800'
  return 'text-emerald-800'
}

function isFoodExpired(value?: string): boolean {
  if (!value) return false
  const normalizedValue = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : value.includes('T') ? `${value}Z` : `${value}T00:00:00Z`
  const expiryTime = new Date(normalizedValue).getTime()
  return Number.isFinite(expiryTime) && expiryTime <= Date.now()
}

function donationCardStatuses(donation: PublicDonation): string[] {
  const remainingQuantity = donation.remaining_quantity ?? donation.quantity
  const expiryValue = donation.available_until
  const expiryTime = expiryValue
    ? new Date(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(expiryValue)
        ? expiryValue
        : expiryValue.includes('T') ? `${expiryValue}Z` : expiryValue,
    ).getTime()
    : Number.NaN
  const isExpired = Number.isFinite(expiryTime) && expiryTime <= Date.now()

  if (remainingQuantity <= 0 || donation.status === 'completed') {
    return isExpired ? ['Completed', 'Expired'] : ['Completed']
  }
  if (isExpired) return ['Expired']
  return [formatStatus(donation.status)]
}

function isDonationRecord(value: unknown): value is Donation {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.donor_id === 'string'
    && typeof record.food_name === 'string'
    && typeof record.status === 'string'
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== 'object') return false
  const user = value as Record<string, unknown>
  return typeof user.id === 'string'
    && typeof user.full_name === 'string'
    && typeof user.email === 'string'
    && ['donor', 'requester', 'volunteer', 'ngo', 'admin'].includes(String(user.role))
}

function readStoredSessionUser(): SessionUser | null {
  const rawSession = localStorage.getItem('smart_food_session')
  if (!rawSession || !localStorage.getItem('smart_food_token')) {
    localStorage.removeItem('smart_food_session')
    return null
  }
  try {
    const value: unknown = JSON.parse(rawSession)
    if (!isSessionUser(value)) {
      throw new Error('Stored session is missing required user details.')
    }
    return value
  } catch (error) {
    console.warn('Stored login session is invalid and will be cleared.', error)
    localStorage.removeItem('smart_food_session')
    return null
  }
}

function roleDisplayName(role: Role): string {
  if (role === 'requester') return 'Receiver'
  if (role === 'ngo') return 'NGO / Organization'
  return role[0].toUpperCase() + role.slice(1)
}

function quantityUnitLabel(quantity: number, unit: string): string {
  if (quantity !== 1) return unit
  const singularUnits: Record<string, string> = {
    meals: 'meal',
    servings: 'serving',
    packets: 'packet',
    boxes: 'box',
    kilograms: 'kilogram',
  }
  return singularUnits[unit.toLowerCase()] || unit
}

function formatRequestStatus(value: string): string {
  return value === 'completed' || value === 'fulfilled' ? 'Fulfilled' : formatStatus(value)
}

function localDateInputValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateTimeInputValue(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

function dateTimeInputToIso(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''
}

async function apiRequest(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('smart_food_token')
  const headers = new Headers(options.headers || {})
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    })
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Could not reach the backend. Check that it is running and CORS is configured.${reason}`)
  }

  const text = await response.text()
  let body: any = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`The backend returned an unreadable response (HTTP ${response.status}).`)
    }
  }

  if (!response.ok) {
    throw new Error(body.error || `Request failed (HTTP ${response.status})`)
  }

  return body
}

function DashboardRoleRoute({ user, onLogout, onRoleChange, onUserUpdate }: {
  user: SessionUser
  onLogout: () => void
  onRoleChange: (user: SessionUser, token: string) => void
  onUserUpdate: (user: SessionUser) => void
}) {
  const { role } = useParams()
  const navigate = useNavigate()
  const [roleError, setRoleError] = useState<{ key: string; message: string } | null>(null)
  const roleSwitchRequestRef = useRef<{ key: string; promise: Promise<{ user: SessionUser; token: string }> } | null>(null)

  useEffect(() => {
    if (!isDashboardRole(role)) {
      navigate(`/dashboard/${user.role}`, { replace: true })
      return
    }
    if (role === user.role) return
    if (role === 'admin' || user.role === 'admin') {
      navigate(`/dashboard/${user.role}`, { replace: true })
      return
    }

    let active = true
    const requestKey = `${user.id}:${role}`
    if (roleSwitchRequestRef.current?.key !== requestKey) {
      roleSwitchRequestRef.current = {
        key: requestKey,
        promise: apiRequest('/auth/switch-role', {
          method: 'POST',
          body: JSON.stringify({ role }),
        }),
      }
    }
    const roleSwitchRequest = roleSwitchRequestRef.current
    roleSwitchRequest.promise
      .then((response) => {
        if (active) onRoleChange(response.user, response.token)
      })
      .catch((error) => {
        if (!active) return
        setRoleError({
          key: requestKey,
          message: error instanceof Error ? error.message : 'Unable to restore the selected account role.',
        })
      })
      .finally(() => {
        if (roleSwitchRequestRef.current === roleSwitchRequest) roleSwitchRequestRef.current = null
      })
    return () => {
      active = false
    }
  }, [navigate, onRoleChange, role, user.id, user.role])

  if (!isDashboardRole(role)) return null
  const requestKey = `${user.id}:${role}`
  if (roleError?.key === requestKey) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <section className="section-shell rounded-[28px] p-6" role="alert">
          <h1 className="text-xl font-bold text-slate-900">Unable to restore dashboard role</h1>
          <p className="mt-2 text-sm text-slate-600">{roleError.message}</p>
          <Link to="/" className="primary-btn mt-4 inline-flex px-4 py-2 text-sm font-semibold">Choose a role</Link>
        </section>
      </main>
    )
  }
  if (role !== user.role) {
    return <main className="p-8 text-center text-sm text-slate-600" role="status">Restoring your {roleDisplayName(role)} dashboard…</main>
  }
  return <DashboardPage user={user} onLogout={onLogout} onUserUpdate={onUserUpdate} />
}

function App() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(readStoredSessionUser)

  const [token, setToken] = useState<string | null>(() => localStorage.getItem('smart_food_token'))
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null)
  const authReady = !token || verifiedToken === token

  useEffect(() => {
    if (sessionUser) {
      localStorage.setItem('smart_food_session', JSON.stringify(sessionUser))
    } else {
      localStorage.removeItem('smart_food_session')
    }
  }, [sessionUser])

  useEffect(() => {
    if (token) {
      localStorage.setItem('smart_food_token', token)
    } else {
      localStorage.removeItem('smart_food_token')
    }
  }, [token])

  useEffect(() => {
    let active = true
    if (!token) return

    apiRequest('/auth/me')
      .then((response) => {
        if (active) {
          setSessionUser(response.user)
          setVerifiedToken(token)
        }
      })
      .catch(() => {
        if (active) {
          setSessionUser(null)
          setToken(null)
          setVerifiedToken(null)
          localStorage.removeItem('smart_food_session')
          localStorage.removeItem('smart_food_token')
        }
      })
    return () => {
      active = false
    }
  }, [token])

  const handleLogin = useCallback((user: SessionUser, newToken: string) => {
    localStorage.setItem('smart_food_session', JSON.stringify(user))
    localStorage.setItem('smart_food_token', newToken)
    setSessionUser(user)
    setToken(newToken)
    setVerifiedToken(newToken)
  }, [])

  const handleUserUpdate = useCallback((user: SessionUser) => {
    setSessionUser(user)
  }, [])

  const handleLogout = async () => {
    try {
      if (token) {
        await apiRequest('/auth/logout', { method: 'POST' })
      }
    } catch {
      // Let the local session clear even if the API is unavailable
    } finally {
      localStorage.removeItem('smart_food_session')
      localStorage.removeItem('smart_food_token')
      sessionStorage.removeItem('smart_food_session')
      sessionStorage.removeItem('smart_food_token')
      setSessionUser(null)
      setToken(null)
      setVerifiedToken(null)
      window.location.href = '/dashboard'
    }
  }

  return (
    <BrowserRouter>
      <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/entry" element={<EntryPage user={sessionUser} onLogin={handleLogin} />} />
          <Route path="/home" element={<LandingPage />} />
          <Route path="/auth" element={<AuthPage onLogin={handleLogin} currentUser={sessionUser} />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/browse" element={<PublicBrowsePage user={sessionUser} />} />
          <Route path="/food/:donationId" element={<PublicFoodDetailPage user={sessionUser} />} />
          <Route
            path="/delivery-issues/:issueId"
            element={
              <AuthenticationRequired user={sessionUser} authReady={authReady}>
                {sessionUser ? <DeliveryIssuePage user={sessionUser} /> : null}
              </AuthenticationRequired>
            }
          />
          <Route
            path="/delivery-feedback/:taskId"
            element={
              <AuthenticationRequired user={sessionUser} authReady={authReady}>
                {sessionUser ? <DeliveryFeedbackPage user={sessionUser} /> : null}
              </AuthenticationRequired>
            }
          />
          <Route path="/dashboard" element={<PublicBrowsePage user={sessionUser} />} />
          <Route
            path="/dashboard/:role"
            element={
              <AuthenticationRequired user={sessionUser} authReady={authReady}>
                {sessionUser ? <DashboardRoleRoute user={sessionUser} onLogout={handleLogout} onRoleChange={handleLogin} onUserUpdate={handleUserUpdate} /> : null}
              </AuthenticationRequired>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function EntryPage({ user, onLogin }: { user: SessionUser | null; onLogin: (user: SessionUser, token: string) => void }) {
  const navigate = useNavigate()
  const [roleSwitchError, setRoleSwitchError] = useState('')
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)
  const roles = [
    {
      title: 'Donate Food',
      description: 'Share surplus food with people who need it.',
      role: 'donor' as const,
      icon: Leaf,
    },
    {
      title: 'Receiver',
      description: 'Find available food and submit a request.',
      role: 'requester' as const,
      icon: Package,
    },
    {
      title: 'Volunteer',
      description: 'Help connect food with people and organizations.',
      role: 'volunteer' as const,
      icon: Users,
    },
    {
      title: 'NGO / Organization',
      description: 'Coordinate food distribution and requests.',
      role: 'ngo' as const,
      icon: HeartHandshake,
    },
  ]

  const selectRole = async (role: UserRole) => {
    if (user) {
      setRoleSwitchError('')
      try {
        const response = await apiRequest('/auth/switch-role', {
          method: 'POST',
          body: JSON.stringify({ role }),
        })
        onLogin(response.user, response.token)
        navigate(`/dashboard/${response.user.role}`)
      } catch (error) {
        setRoleSwitchError(error instanceof Error ? error.message : 'Unable to switch account role.')
      }
      return
    }
    navigate(`/auth?mode=login&role=${role}`)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7f1] px-4 py-10 text-slate-900">
      <section className="w-full max-w-4xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1d4d3d]">Smart Food</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">REDISTRIBUTION SYSTEM</h1>
          <p className="mt-4 text-lg text-slate-600">How would you like to use the platform?</p>
          {user && <p className="mt-2 text-sm text-slate-500">Signed in as {user.full_name} ({roleDisplayName(user.role)}); choices open your existing dashboard.</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {roles.map(({ title, description, role, icon: Icon }) => (
            <button
              key={title}
              type="button"
              aria-pressed={selectedRole === role}
              onClick={() => setSelectedRole(role)}
              className={`group rounded-3xl border bg-white p-6 text-left shadow-[0_12px_32px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-1 hover:border-[#b8d9c3] hover:shadow-[0_18px_38px_rgba(15,23,42,0.1)] active:translate-y-0 active:scale-[0.99] ${
                selectedRole === role ? 'border-[#1d4d3d] ring-2 ring-[#1d4d3d]/20' : 'border-slate-200'
              }`}
            >
              <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#edf8ef] text-[#1d4d3d]">
                <Icon size={20} />
              </span>
              <span className="block text-lg font-bold text-slate-900">{title}</span>
              <span className="mt-1 block text-sm leading-6 text-slate-600">{description}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!selectedRole}
          onClick={() => {
            if (selectedRole) void selectRole(selectedRole)
          }}
          className="primary-btn mt-6 w-full px-6 py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="inline-flex items-center justify-center gap-2">Continue<ArrowRight size={17} /></span>
        </button>
        {roleSwitchError && <p className="mt-4 text-center text-sm text-red-700" role="alert">{roleSwitchError}</p>}
        <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-5 text-slate-500">
          Select one role, then continue to its login page. Your role will be carried into the dashboard.
        </p>
        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account? <Link to="/auth?mode=login" className="font-semibold text-[#1d4d3d] hover:underline">Sign in</Link>
          {' · '}
          <Link to="/home" className="font-semibold text-[#1d4d3d] hover:underline">Learn about the platform</Link>
          {' · '}
          <Link to="/dashboard" className="font-semibold text-[#1d4d3d] hover:underline">Browse food and community needs</Link>
        </p>
      </section>
    </main>
  )
}

function LandingPage() {
  const [overview, setOverview] = useState<PublicDashboardOverview | null>(null)
  const [availableDonations, setAvailableDonations] = useState<PublicDonationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const refreshOverview = () => {
      apiRequest('/dashboard/public-overview')
        .then((overviewResponse) => {
          if (active) setOverview(overviewResponse)
        })
        .catch((requestError) => {
          if (active) {
            setError(requestError instanceof Error ? requestError.message : 'Unable to refresh public dashboard.')
          }
        })
    }
    Promise.all([
      apiRequest('/dashboard/public-overview'),
      apiRequest('/donations?scope=public_available'),
    ])
      .then(([overviewResponse, donationsResponse]) => {
        if (!active) return
        setOverview(overviewResponse)
        setAvailableDonations((donationsResponse.donations || []).map(publicDonationSummary))
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load public impact information.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const handleWindowFocus = () => refreshOverview()
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshOverview()
    }, 30000)
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      active = false
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [])

  const stats = [
    { label: 'Meals redistributed', value: overview?.stats.meals_redistributed, icon: Leaf },
    { label: 'Donations listed', value: overview?.stats.total_donations, icon: Users },
    { label: 'NGOs connected', value: overview?.stats.connected_organizations, icon: HeartHandshake },
  ]
  const needs = overview?.community_needs || []
  const featuredNeed = needs.find((need) => ['urgent', 'high', 'critical'].includes(need.urgency.toLowerCase())) || needs[0]
  const featuredDonations = availableDonations.slice(0, 3)

  const features = [
    { title: 'Smart donation matching', description: 'Connect donors with urgent local needs in minutes.', icon: Sparkles },
    { title: 'Verified status tracking', description: 'Track every donation from listing to completion.', icon: CheckCircle2 },
    { title: 'Impact analytics', description: 'See community outcomes and meal totals in real time.', icon: BarChart3 },
  ]

  return (
    <div className="landing-page min-h-screen bg-[#f4f7f1] text-slate-900">
      <header className="mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <nav className="card-surface flex items-center justify-between rounded-full px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1d4d3d] text-white">
              <Leaf size={18} />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900">Smart Food</p>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Redistribution</p>
            </div>
          </div>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#how-it-works" className="text-sm font-medium text-slate-700 transition hover:text-[#1d4d3d]">How it works</a>
            <a href="#impact" className="text-sm font-medium text-slate-700 transition hover:text-[#1d4d3d]">Impact</a>
            <a href="#features" className="text-sm font-medium text-slate-700 transition hover:text-[#1d4d3d]">Features</a>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold">
              Continue <ArrowRight size={16} />
            </Link>
            <Link to="/auth?mode=login&show_login=true" className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold">
              Login / Sign In
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8 lg:pt-16">
          <div className="flex flex-col justify-center">
            <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#d4f0dd] bg-[#ecfdf5] px-3 py-1 text-sm font-medium text-[#0f5c46]">
              <Sparkles size={15} />
              Reducing food waste, feeding communities
            </div>

            <h1 className="max-w-xl text-4xl font-black tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Rescue surplus food. Rebuild communities.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              Connect restaurants, hotels, and households with NGOs and food programs to redistribute edible meals before they are wasted.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link to={loginUrl('donor', '/dashboard/donor#create-donation')} className="primary-btn inline-flex items-center gap-2 px-6 py-3 text-base font-semibold">
                List a donation <ArrowRight size={18} />
              </Link>
              <Link to={loginUrl('requester', '/dashboard/requester#marketplace')} className="secondary-btn inline-flex items-center gap-2 px-6 py-3 text-base font-semibold">
                Request food
              </Link>
            </div>

            <div className="mt-10 grid max-w-lg gap-4 sm:grid-cols-3">
              {stats.map(({ label, value, icon: Icon }) => (
                <div key={label} className="section-shell rounded-2xl p-4">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf8ef] text-[#1d4d3d]">
                    <Icon size={18} />
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{loading || value === undefined ? '—' : value.toLocaleString()}</div>
                  <p className="text-sm text-slate-600">{label}</p>
                </div>
              ))}
            </div>
            {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
          </div>

          <div className="soft-grid relative overflow-hidden rounded-[32px] border border-[#dfeee1] bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.07)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(251,146,60,0.22),_transparent_28%)]" />
            <div className="relative space-y-5">
              <div className="rounded-3xl bg-[#ecfdf5] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-600">Urgent community need</p>
                  {featuredNeed && <span className="rounded-full bg-[#fef3c7] px-2.5 py-1 text-xs font-semibold text-[#92400e]">{featuredNeed.urgency || 'Active'}</span>}
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    {loading ? <p className="text-sm text-slate-600">Loading community needs…</p> : featuredNeed ? (
                      <>
                        <p className="text-2xl font-bold text-slate-900">{featuredNeed.category || 'Food'} · {featuredNeed.remaining_quantity ?? featuredNeed.required_quantity} servings</p>
                        <p className="text-sm text-slate-600">{featuredNeed.location}{featuredNeed.city ? `, ${featuredNeed.city}` : ''}</p>
                      </>
                    ) : <p className="text-sm text-slate-600">No active community food needs are listed.</p>}
                  </div>
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#1d4d3d] shadow-sm">
                    <Package size={24} />
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-[#ffffff] p-4">
                <div className="mb-3 flex items-center justify-between text-sm text-slate-600">
                  <span>Available donations</span>
                  <span className="font-semibold text-[#1d4d3d]">{loading ? '—' : `${availableDonations.length} available`}</span>
                </div>
                <div className="space-y-3">
                  {loading ? <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">Loading current listings…</p> : featuredDonations.length ? featuredDonations.map((donation) => (
                    <div key={donation.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-800">{donation.food_name}</p>
                        <p className="text-xs text-slate-500">{donation.available_quantity} {donation.quantity_unit} · {donation.city || 'Location not specified'}</p>
                      </div>
                      <Link to={`/food/${encodeURIComponent(donation.id)}`} className="ml-2 shrink-0 text-xs font-semibold text-[#1d4d3d] underline">Details</Link>
                    </div>
                  )) : <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">No food donations are currently available.</p>}
                </div>
              </div>

              <div className="rounded-3xl bg-[#1d4d3d] p-5 text-white">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm text-emerald-100">Impact tracking</p>
                  <ShieldCheck size={18} className="text-emerald-300" />
                </div>
                <p className="text-3xl font-bold">{loading || !overview ? '—' : overview.stats.meals_redistributed.toLocaleString()}</p>
                <p className="mt-1 text-sm text-emerald-100">meals redistributed, based on completed delivery data.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">How it works</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">A simple path from surplus to support</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              ['1. List your surplus food', 'Donors upload meal details, timing, and pickup information in minutes.'],
              ['2. Match with local needs', 'NGOs and community kitchens see urgent requests and request exactly what is needed.'],
              ['3. Track impact and certify completion', 'Every donation is logged with status history, distribution notes, and analytics.'],
            ].map(([title, description]) => (
              <div key={title} className="section-shell rounded-3xl p-6">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf8ef] text-[#1d4d3d] font-bold">{title.split('.')[0]}</div>
                <h3 className="text-xl font-bold text-slate-900">{title}</h3>
                <p className="mt-3 text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="impact" className="bg-[#133e32] py-20 text-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-200">Impact</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Turning food recovery into measurable action</h2>
            </div>
            <div className="grid gap-6 md:grid-cols-4">
              {[
                [overview?.stats.meals_redistributed, 'Meals redistributed'],
                [overview?.stats.fulfilled_requests, 'Community requests fulfilled'],
                [overview?.stats.meals_redistributed_before_expiry, 'Meals redistributed before expiry'],
                [overview?.stats.connected_organizations, 'Partner organizations'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-3xl border border-emerald-700/50 bg-white/5 p-5 text-center backdrop-blur-sm">
                  <p className="text-3xl font-black">{loading || value === undefined ? '—' : Number(value).toLocaleString()}</p>
                  <p className="mt-2 text-sm text-emerald-100">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">Platform features</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">Built for real community operations</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {features.map(({ title, description, icon: Icon }) => (
              <div key={title} className="section-shell rounded-3xl p-6">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4df] text-[#d97706]">
                  <Icon size={22} />
                </div>
                <h3 className="text-xl font-bold text-slate-900">{title}</h3>
                <p className="mt-3 text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-7xl border-t border-slate-200 px-4 py-8 text-sm text-slate-600 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1d4d3d] text-white">
              <Leaf size={16} />
            </div>
            <span className="font-semibold text-slate-900">Smart Food Donation and Redistribution System</span>
          </div>
          <p>© 2026 Smart Food Network</p>
        </div>
      </footer>
    </div>
  )
}

function formatPublicDate(value?: string): string {
  if (!value) return 'Not specified'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not specified' : date.toLocaleString()
}

function publicActionUrl(user: SessionUser | null, role: UserRole, next: string): string {
  return user ? next : loginUrl(role, next)
}

function PublicBrowsePage({ user }: { user: SessionUser | null }) {
  const [donations, setDonations] = useState<PublicDonationSummary[]>([])
  const [availableDonations, setAvailableDonations] = useState<PublicDonationSummary[]>([])
  const [needs, setNeeds] = useState<PublicCommunityNeed[]>([])
  const [overview, setOverview] = useState<PublicDashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/dashboard/public-overview'),
      apiRequest('/donations?scope=public_dashboard'),
      apiRequest('/donations?scope=public_available'),
      apiRequest('/community-needs?scope=public_dashboard'),
    ])
      .then(([overviewResponse, activityResponse, availableResponse, needResponse]) => {
        if (!active) return
        setOverview(overviewResponse)
        setDonations((activityResponse.donations || []).map(publicDonationSummary))
        setAvailableDonations((availableResponse.donations || []).map(publicDonationSummary))
        setNeeds(needResponse.needs || [])
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load public listings.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const stats = overview?.stats
  const statsCards = [
    { label: 'Donations listed', value: stats?.total_donations, icon: HandHeart, color: 'bg-[#edf8ef] text-[#1d4d3d]' },
    { label: 'Available now', value: stats?.available_donations, icon: Utensils, color: 'bg-[#fff4df] text-[#b45309]' },
    { label: 'Meals redistributed', value: stats?.meals_redistributed, icon: Heart, color: 'bg-[#fdf2f8] text-[#be185d]' },
    { label: 'Active donations', value: stats?.active_donations, icon: PackageCheck, color: 'bg-[#eff6ff] text-[#1d4ed8]' },
    { label: 'Requests fulfilled', value: stats?.fulfilled_requests, icon: CheckCircle2, color: 'bg-[#eff6ff] text-[#1d4ed8]' },
    { label: 'Completed donations', value: stats?.completed_donations, icon: BadgeCheck, color: 'bg-[#edf8ef] text-[#1d4d3d]' },
    { label: 'Meals redistributed before expiry', value: stats?.meals_redistributed_before_expiry, icon: Clock3, color: 'bg-[#fff4df] text-[#b45309]' },
    { label: 'Organizations', value: stats?.connected_organizations, icon: Building2, color: 'bg-[#ecfeff] text-[#0f766e]' },
  ]
  const sectionNav = [
    { label: 'Overview', href: '#overview', Icon: LayoutDashboard },
    { label: 'Available food', href: '#marketplace', Icon: Utensils },
    { label: 'Donation activity', href: '#donation-activity', Icon: HandHeart },
    { label: 'Food matches', href: '#food-matches', Icon: Sparkles },
    { label: 'Community needs', href: '#community-needs', Icon: HeartHandshake },
    { label: 'Organizations', href: '#organizations', Icon: Building2 },
    { label: 'Volunteer opportunities', href: '#volunteer-opportunities', Icon: Truck },
    { label: 'Community updates', href: '#community-updates', Icon: Bell },
  ]

  return (
    <main className="min-h-screen bg-[#f4f7f1] px-4 py-6 text-slate-900 sm:px-6 lg:h-screen lg:overflow-hidden lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 lg:h-full lg:flex-row lg:items-start">
        <aside className="card-surface w-full shrink-0 rounded-[28px] p-4 lg:sticky lg:top-5 lg:max-h-full lg:overflow-y-auto lg:overscroll-contain lg:w-[260px]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1d4d3d] text-white"><Leaf size={20} /></div>
            <div>
              <p className="text-base font-bold">Smart Food</p>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Public dashboard</p>
            </div>
          </div>
          <nav aria-label="Public dashboard sections" className="mt-6 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {sectionNav.map(({ label, href, Icon }) => (
              <a key={label} href={href} className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-[#edf8ef] hover:text-[#1d4d3d]">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#edf8ef] text-[#1d4d3d]"><Icon size={15} /></span>
                {label}
              </a>
            ))}
          </nav>
          <Link to="/" className="secondary-btn mt-5 inline-flex w-full justify-center px-3 py-2 text-sm font-medium">Front page</Link>
        </aside>

        <div className="min-w-0 flex-1 space-y-6 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pb-6">
          <header id="overview" className="card-surface scroll-mt-5 rounded-[28px] p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Smart Food Redistribution System</p>
                <h1 className="mt-2 text-3xl font-black text-slate-900">Public Dashboard</h1>
                <p className="mt-1 text-sm text-slate-600">Live public information about available food, community needs, and redistribution impact.</p>
              </div>
              <div className="public-dashboard-actions grid grid-cols-2 gap-2">
                <Link to={publicActionUrl(user, 'donor', '/dashboard/donor#create-donation')} className="secondary-btn w-full px-4 py-2 text-center text-sm font-semibold">Donate Food</Link>
                <Link to={publicActionUrl(user, 'requester', '/dashboard/requester#marketplace')} className="secondary-btn w-full px-4 py-2 text-center text-sm font-semibold">Request Food</Link>
                <Link to={publicActionUrl(user, 'volunteer', '/dashboard/volunteer#tasks')} className="secondary-btn w-full px-4 py-2 text-center text-sm font-semibold">Volunteer</Link>
                <Link to={publicActionUrl(user, 'ngo', '/dashboard/ngo#needs')} className="secondary-btn w-full px-4 py-2 text-center text-sm font-semibold">NGO Assist</Link>
              </div>
            </div>
          </header>

        {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}

          <section aria-label="Public impact statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {statsCards.map(({ label, value, icon: Icon, color }) => (
              <article key={label} className="section-shell rounded-2xl p-4">
                <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${color}`}><Icon size={18} /></div>
                <p className="text-2xl font-bold text-slate-900">{loading ? '—' : (value ?? 0).toLocaleString()}</p>
                <p className="text-sm text-slate-600">{label}</p>
              </article>
            ))}
          </section>

          <section id="marketplace" className="section-shell scroll-mt-5 rounded-[28px] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">Marketplace</p>
                <h2 className="mt-1 text-2xl font-bold">Available food</h2>
              </div>
              <Link to={publicActionUrl(user, 'requester', '/dashboard/requester#marketplace')} className="secondary-btn px-3 py-2 text-sm font-semibold">Request Food</Link>
            </div>
            {loading ? <p className="mt-4 text-sm text-slate-600">Loading available food…</p> : availableDonations.length ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {availableDonations.map((donation) => (
                  <article key={donation.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <DonationImage donation={donation} className="h-48 w-full object-cover" />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><h3 className="text-lg font-bold text-slate-900">{donation.food_name}</h3><p className="mt-1 text-sm text-slate-600">{donation.category}</p></div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {donationCardStatuses(donation).map((status) => (
                            <span key={status} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusToneClass(status)}`}>{status}</span>
                          ))}
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-slate-700">{donation.available_quantity} {donation.quantity_unit} available · {donation.city || 'Location not specified'}</p>
                      <p className="mt-1 text-xs text-slate-500">Prepared {formatPublicDate(donation.preparation_time)} · Listed {formatPublicDate(donation.created_at)} · <span className={`font-semibold ${expiryToneClass(donation.available_until)}`}>Expires {formatPublicDate(donation.available_until)}</span></p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link to={`/food/${encodeURIComponent(donation.id)}`} className="secondary-btn inline-flex px-3 py-2 text-sm font-semibold">View details</Link>
                        <Link to={publicActionUrl(user, 'requester', '/dashboard/requester#marketplace')} className="primary-btn inline-flex px-3 py-2 text-sm font-semibold">Request food</Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No food donations are currently available.</p>}
          </section>

          <section id="donation-activity" className="section-shell scroll-mt-5 rounded-[28px] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">System activity</p>
                <h2 className="mt-1 text-2xl font-bold">Donation activity</h2>
              </div>
              <Link to={publicActionUrl(user, 'donor', '/dashboard/donor#create-donation')} className="primary-btn px-3 py-2 text-sm font-semibold">Donate Food</Link>
            </div>
            {loading ? <p className="mt-4 text-sm text-slate-600">Loading donation activity…</p> : donations.length ? (
              <div className="mt-5 space-y-3">
                {donations.map((donation) => (
                  <article key={donation.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row">
                    <DonationImage donation={donation} className="h-32 w-full shrink-0 rounded-xl object-cover sm:w-40" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><h3 className="font-bold text-slate-900">{donation.food_name}</h3><p className="text-sm text-slate-600">{donation.category} · {donation.city || 'Location not specified'}</p></div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {donationCardStatuses(donation).map((status) => (
                            <span key={status} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusToneClass(status)}`}>{status}</span>
                          ))}
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-slate-700">
                        Listed {donation.quantity} {donation.quantity_unit} · Distributed {donation.distributed_quantity ?? 0} {donation.quantity_unit} · Remaining {donation.remaining_quantity ?? donation.quantity} {donation.quantity_unit}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Listed {formatPublicDate(donation.created_at)} · Valid until {formatPublicDate(donation.available_until)}</p>
                      <Link to={`/food/${encodeURIComponent(donation.id)}`} className="mt-2 inline-flex text-sm font-semibold text-[#1d4d3d] underline">View food details</Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No donation activity is available.</p>}
          </section>

          <section id="food-matches" className="section-shell scroll-mt-5 rounded-[28px] p-5">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">Smart matching</p>
              <h2 className="mt-1 text-2xl font-bold">Available food matched to community needs</h2>
              <p className="mt-1 text-sm text-slate-600">Matches require the same category and city, with available servings sufficient for the remaining need.</p>
            </div>
            {loading ? <p className="mt-4 text-sm text-slate-600">Checking available listings and needs…</p> : overview?.matches.length ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {overview.matches.map((match) => (
                  <article key={`${match.donation_id}:${match.need_id}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-[#1d4d3d]"><Sparkles size={16} /><h3 className="font-bold">{match.food_name}</h3></div>
                    <p className="mt-2 text-sm text-slate-700">{match.available_quantity} {match.quantity_unit} available in {match.city}</p>
                    <p className="mt-1 text-sm text-slate-600">Matches {match.need_remaining_quantity} servings needed{match.organization_name ? ` by ${match.organization_name}` : ''}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link to={`/food/${encodeURIComponent(match.donation_id)}`} className="text-sm font-semibold text-[#1d4d3d] underline">View food details</Link>
                      <Link to={publicActionUrl(user, 'requester', '/dashboard/requester#marketplace')} className="text-sm font-semibold text-[#1d4d3d] underline">Request food</Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : !error ? <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No suitable food-to-need matches can be confirmed from the current category, quantity, and location data.</p> : null}
          </section>

          <section id="community-needs" className="section-shell scroll-mt-5 rounded-[28px] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">Community</p>
                <h2 className="mt-1 text-2xl font-bold">Community food needs</h2>
              </div>
              <Link to={publicActionUrl(user, 'ngo', '/dashboard/ngo#needs')} className="secondary-btn px-3 py-2 text-sm font-semibold">NGO Assist</Link>
            </div>
            {loading ? <p className="mt-4 text-sm text-slate-600">Loading community needs…</p> : needs.length ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {needs.map((need) => {
                  const deliveredQuantity = need.delivered_quantity ?? 0
                  const remainingQuantity = need.remaining_quantity ?? Math.max(0, need.required_quantity - deliveredQuantity)
                  const quantityUnit = quantityUnitLabel(need.required_quantity, 'servings')

                  return (
                    <article key={need.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4d3d]">{need.category || 'Community need'}</p>
                          <h3 className="mt-1 text-lg font-bold text-slate-900">
                            {need.required_quantity} {quantityUnit} needed
                          </h3>
                          <p className="mt-1 text-sm text-slate-600">{need.location}{need.city ? `, ${need.city}` : ''}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{need.urgency || 'Standard'} priority</span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusToneClass(need.status)}`}>{formatStatus(need.status)}</span>
                        </div>
                      </div>
                      {need.organization_name && <p className="mt-2 text-sm font-medium text-slate-700">Organization: {need.organization_name}</p>}
                      {need.description && <p className="mt-3 text-sm leading-6 text-slate-700">{need.description}</p>}
                      <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">Delivered</dt>
                          <dd className="mt-1 font-medium text-slate-800">{deliveredQuantity} {quantityUnitLabel(deliveredQuantity, 'servings')}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">Remaining</dt>
                          <dd className="mt-1 font-medium text-slate-800">{remainingQuantity} {quantityUnitLabel(remainingQuantity, 'servings')}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">Needed by</dt>
                          <dd className="mt-1 text-slate-700">{formatPublicDate(need.required_date)}</dd>
                        </div>
                        {need.created_at && (
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">Listed</dt>
                            <dd className="mt-1 text-slate-700">{formatPublicDate(need.created_at)}</dd>
                          </div>
                        )}
                      </dl>
                      <Link to={publicActionUrl(user, 'donor', '/dashboard/donor#community-needs')} className="secondary-btn mt-4 inline-flex px-3 py-2 text-sm font-semibold">Help meet this need</Link>
                    </article>
                  )
                })}
              </div>
            ) : !error ? <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No active community food needs are currently listed.</p> : null}
          </section>

          <section id="organizations" className="section-shell scroll-mt-5 rounded-[28px] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">Network</p><h2 className="mt-1 text-2xl font-bold">Connected organizations</h2></div>
              <span className="rounded-full bg-[#edf8ef] px-3 py-1 text-sm font-semibold text-[#1d4d3d]">{stats?.connected_organizations ?? 0} organizations</span>
            </div>
            {loading ? <p className="mt-4 text-sm text-slate-600">Loading organizations…</p> : overview?.organizations.length ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {overview.organizations.map((organization) => (
                  <article key={`${organization.organization_name}:${organization.city}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf8ef] text-[#1d4d3d]"><Building2 size={18} /></span>
                    <div><h3 className="font-semibold text-slate-900">{organization.organization_name}</h3><p className="text-sm text-slate-600">{organization.city || 'Location not listed'}</p></div>
                  </article>
                ))}
              </div>
            ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No organization details are currently available.</p>}
          </section>

          <section id="volunteer-opportunities" className="section-shell scroll-mt-5 rounded-[28px] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">Volunteer network</p><h2 className="mt-1 text-2xl font-bold">Volunteer opportunities</h2></div>
              <Link to={publicActionUrl(user, 'volunteer', '/dashboard/volunteer#tasks')} className="secondary-btn px-3 py-2 text-sm font-semibold">View volunteer tasks</Link>
            </div>
            {loading ? <p className="mt-4 text-sm text-slate-600">Loading volunteers…</p> : overview?.volunteers.length ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {overview.volunteers.map((volunteer) => (
                  <article key={volunteer.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf8ef] text-[#1d4d3d]"><Truck size={18} /></span>
                    <div><h3 className="font-semibold text-slate-900">{volunteer.full_name || 'Registered volunteer'}</h3><p className="text-sm text-slate-600">{volunteer.city || 'Location not listed'} · {formatStatus(volunteer.status)}</p></div>
                  </article>
                ))}
              </div>
            ) : !error ? <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No open volunteer opportunities are currently listed.</p> : null}
          </section>

          <section id="community-updates" className="section-shell scroll-mt-5 rounded-[28px] p-5">
            <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">Community updates</p><h2 className="mt-1 text-2xl font-bold">Public updates and alerts</h2></div>
            {loading ? <p className="mt-4 text-sm text-slate-600">Loading public updates…</p> : overview?.alerts.length ? (
              <ul className="mt-5 space-y-3">
                {overview.alerts.map((alert, index) => (
                  <li key={`${alert.type}:${alert.created_at}:${index}`} className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <Bell size={18} className="mt-0.5 shrink-0 text-amber-800" />
                    <div><p className="text-sm font-medium text-slate-900">{alert.message}</p><p className="mt-1 text-xs text-slate-600">{formatPublicDate(alert.created_at)}</p></div>
                  </li>
                ))}
              </ul>
            ) : !error ? <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">There are no current public alerts.</p> : null}
          </section>

          <section className="section-shell flex flex-wrap items-center justify-between gap-4 rounded-[28px] p-5">
            <div><h2 className="text-xl font-bold">Protected application actions</h2><p className="mt-1 text-sm text-slate-600">Browsing is public. Sign in is requested only when you choose an action that requires an account.</p></div>
            <div className="flex flex-wrap gap-2">
              <Link to={publicActionUrl(user, 'requester', '/dashboard/requester#requests')} className="secondary-btn px-3 py-2 text-sm font-semibold">My Requests</Link>
              <Link to={publicActionUrl(user, 'donor', '/dashboard/donor#donations')} className="secondary-btn px-3 py-2 text-sm font-semibold">My Donations</Link>
              <Link to={publicActionUrl(user, 'requester', '/dashboard/requester#requests')} className="secondary-btn px-3 py-2 text-sm font-semibold">Raise Issue</Link>
              <Link to={publicActionUrl(user, 'volunteer', '/dashboard/volunteer#tasks')} className="secondary-btn px-3 py-2 text-sm font-semibold">Volunteer</Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function PublicFoodDetailPage({ user }: { user: SessionUser | null }) {
  const { donationId = '' } = useParams()
  const [donation, setDonation] = useState<PublicDonation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    apiRequest(`/donations/${encodeURIComponent(donationId)}`)
      .then((response) => {
        if (active) setDonation(response.donation || null)
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load this food listing.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [donationId])

  return (
    <main className="min-h-screen bg-[#f4f7f1] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <section className="section-shell mx-auto max-w-4xl rounded-[28px] p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/dashboard" className="text-sm font-semibold text-[#1d4d3d] underline">Browse all food</Link>
          <Link to="/home" className="text-sm font-semibold text-[#1d4d3d] underline">Home</Link>
        </div>
        {loading ? <p className="mt-6 text-sm text-slate-600">Loading food details…</p> : error ? (
          <p role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
        ) : donation ? (
          <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <DonationImage donation={donation} className="h-72 w-full rounded-2xl object-cover" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#1d4d3d]">{donation.category}</p>
              <h1 className="mt-2 text-3xl font-black">{donation.food_name}</h1>
              <p className="mt-3 text-slate-700">{donation.description || 'No additional description provided.'}</p>
              <dl className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <div><dt className="font-semibold text-slate-500">Original quantity</dt><dd className="mt-1">{donation.quantity} {donation.quantity_unit}</dd></div>
                <div><dt className="font-semibold text-slate-500">Distributed</dt><dd className="mt-1">{donation.distributed_quantity ?? 0} {donation.quantity_unit}</dd></div>
                <div><dt className="font-semibold text-slate-500">Remaining</dt><dd className="mt-1">{donation.remaining_quantity ?? donation.quantity} {donation.quantity_unit}</dd></div>
                <div><dt className="font-semibold text-slate-500">Available to request</dt><dd className="mt-1">{donation.available_quantity ?? 0} {donation.quantity_unit}</dd></div>
                <div><dt className="font-semibold text-slate-500">Status</dt><dd className="mt-1">{formatStatus(donation.status)}</dd></div>
                <div><dt className="font-semibold text-slate-500">Location</dt><dd className="mt-1">{donation.city || 'Not specified'}</dd></div>
                <div><dt className="font-semibold text-slate-500">Category</dt><dd className="mt-1">{donation.category}</dd></div>
                <div><dt className="font-semibold text-slate-500">Prepared</dt><dd className="mt-1">{formatPublicDate(donation.preparation_time)}</dd></div>
                <div><dt className="font-semibold text-slate-500">Listed</dt><dd className="mt-1">{formatPublicDate(donation.created_at)}</dd></div>
                <div><dt className="font-semibold text-slate-500">Exact expiry</dt><dd className={`mt-1 font-semibold ${expiryToneClass(donation.available_until)}`}>{formatPublicDate(donation.available_until)}</dd></div>
              </dl>
              {donation.is_requestable ? (
                <Link to={publicActionUrl(user, 'requester', '/dashboard/requester#marketplace')} className="primary-btn mt-5 inline-flex px-5 py-3 text-sm font-semibold">
                  {user ? 'Request food' : 'Sign in to request food'}
                </Link>
              ) : <p className="mt-5 text-sm font-semibold text-slate-600">{donation.status === 'completed' ? 'This donation was fully distributed.' : donation.status === 'expired' ? 'This donation has expired and cannot be requested.' : 'No quantity is currently available to request.'}</p>}
              <section className="mt-6" aria-label="Donation journey">
                <h2 className="text-lg font-bold text-slate-900">Donation journey</h2>
                {donation.status_history?.length ? (
                  <ol className="mt-3 space-y-2 border-l-2 border-[#d8e8dc] pl-4">
                    {donation.status_history.map((entry, index) => (
                      <li key={`${entry.status}:${entry.created_at}:${index}`} className="text-sm text-slate-700">
                        <span className="font-semibold">{formatStatus(entry.status)}</span>
                        <span className="ml-2 text-slate-500">{formatPublicDate(entry.created_at)}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-2 text-sm text-slate-500">No donation status history has been recorded.</p>}
              </section>
            </div>
          </div>
        ) : <p className="mt-6 text-sm text-slate-600">This food listing is unavailable.</p>}
      </section>
    </main>
  )
}

function roleEmailStorageKey(role: UserRole): string {
  return `smart_food_email_suggestions_${role}`
}

function readRoleEmailSuggestions(role: UserRole): string[] {
  try {
    const saved = localStorage.getItem(roleEmailStorageKey(role))
    const emails: unknown = saved ? JSON.parse(saved) : []
    return Array.isArray(emails)
      ? emails.filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
      : []
  } catch (error) {
    console.warn(`Unable to read ${role} email suggestions.`, error)
    return []
  }
}

function saveRoleEmailSuggestion(role: UserRole, email: string): void {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return

  try {
    const emails = readRoleEmailSuggestions(role)
    if (emails.some((savedEmail) => savedEmail.toLowerCase() === normalizedEmail)) return
    localStorage.setItem(roleEmailStorageKey(role), JSON.stringify([...emails, normalizedEmail]))
  } catch (error) {
    console.warn(`Unable to save ${role} email suggestion.`, error)
  }
}

function AuthPage({ onLogin, currentUser }: { onLogin: (user: SessionUser, token: string) => void; currentUser: SessionUser | null }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<'login' | 'register'>(searchParams.get('mode') === 'register' ? 'register' : 'login')
  const queryRole = searchParams.get('role')
  const requestedRole = isUserRole(queryRole) ? queryRole : undefined
  const requestedNext = safeNextPath(searchParams.get('next'))
  const showLoginForm = searchParams.get('show_login') === 'true'
  const [emailSuggestions, setEmailSuggestions] = useState<string[]>(() => readRoleEmailSuggestions(requestedRole || 'donor'))
  const [emailSuggestionsOpen, setEmailSuggestionsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: requestedRole || 'donor',
    organization_name: '',
    phone: '',
    city: '',
    address: '',
  })

  useEffect(() => {
    setMode(searchParams.get('mode') === 'register' ? 'register' : 'login')
    const selectedRole = searchParams.get('role')
    const role = isUserRole(selectedRole) ? selectedRole : 'donor'
    setForm((current) => ({ ...current, role, email: '' }))
    setEmailSuggestions(readRoleEmailSuggestions(role))
    setEmailSuggestionsOpen(false)
  }, [searchParams])

  useEffect(() => {
    if (currentUser && !showLoginForm) {
      navigate(requestedNext || `/dashboard/${currentUser.role}`, { replace: true })
    }
  }, [currentUser, navigate, requestedNext, showLoginForm])

  const handleChange = (field: string, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  const handleRoleChange = (role: UserRole) => {
    setForm((previous) => ({ ...previous, role, email: mode === 'login' ? previous.email : '' }))
    setEmailSuggestions(readRoleEmailSuggestions(role))
    setEmailSuggestionsOpen(false)
  }

  const selectEmailSuggestion = (email: string) => {
    setForm((previous) => ({ ...previous, email }))
    setEmailSuggestionsOpen(false)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    if (mode === 'login' && !form.email.trim()) {
      setMessage('Enter your email address.')
      return
    }
    if (mode === 'login' && !form.password.trim()) {
      setMessage('Enter your password.')
      return
    }
    setLoading(true)

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
      const payload = mode === 'login'
        ? { email: form.email.trim(), password: form.password, role: form.role }
        : { ...form, email: form.email.trim(), password: form.password, role: form.role }

      const response = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      if (
        !response.token
        || !response.user?.id
        || response.user.role !== form.role
        || (form.email.trim() && response.user.email?.trim().toLowerCase() !== form.email.trim().toLowerCase())
      ) {
        throw new Error('Authentication succeeded without a matching saved account and session. Please try again.')
      }

      if (isUserRole(response.user.role)) {
        saveRoleEmailSuggestion(response.user.role, form.email)
      }
      onLogin(response.user, response.token)
      navigate(requestedNext || `/dashboard/${response.user.role}`, { replace: true })
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Authentication failed'
      if (mode === 'register' && text.includes('already exists')) {
        setMessage('This account already exists. Please sign in.')
        setMode('login')
        return
      }
      setMessage(text)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#effaf1,_#f7faf7_40%,_#edf3ee)] p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/80 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <div className="grid lg:grid-cols-2">
          <div className="hidden bg-[#1d4d3d] p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                  <Leaf size={22} />
                </div>
                <div>
                  <p className="text-xl font-bold">Smart Food</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Redistribution system</p>
                </div>
              </div>
              <h1 className="max-w-md text-4xl font-black leading-tight">Join a smarter community response to hunger.</h1>
              <p className="mt-5 max-w-md text-emerald-100/90">
                Reduce food waste, support local NGOs, and track every donation with secure, transparent workflows.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/5 p-4 backdrop-blur-sm">
                <p className="text-2xl font-black">Public</p>
                <p className="mt-1 text-sm text-emerald-100">browse food and community needs without signing in</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 backdrop-blur-sm">
                <p className="text-2xl font-black">Protected</p>
                <p className="mt-1 text-sm text-emerald-100">sign in only when taking an account action</p>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1d4d3d]">Welcome</p>
                <h2 className="mt-2 text-3xl font-bold text-slate-900">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
              </div>
              <Link to="/" className="secondary-btn px-3 py-2 text-sm font-medium">Back home</Link>
            </div>

            <div className="mb-6 inline-flex rounded-full bg-slate-100 p-1">
              {(['login', 'register'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${mode === value ? 'bg-white text-[#1d4d3d] shadow-sm' : 'text-slate-600'}`}
                >
                  <span className="inline-flex items-center gap-1.5">{value === 'login' ? <LogIn size={15} /> : <Plus size={15} />}{value === 'login' ? 'Login' : 'Sign Up'}</span>
                </button>
              ))}
            </div>

            {mode === 'login' && (
              <div className="mb-6 grid grid-cols-2 gap-2">
                {([
                  ['donor', 'Donor'],
                  ['requester', 'Request Food / Receiver'],
                  ['volunteer', 'Volunteer'],
                  ['ngo', 'NGO / Organization'],
                ] as const).map(([role, label]) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleRoleChange(role)}
                    aria-pressed={form.role === role}
                    className={`inline-flex min-h-11 w-full items-center justify-center rounded-2xl border px-3 py-2 text-center text-sm font-semibold transition ${form.role === role ? 'border-[#1d4d3d] bg-[#1d4d3d] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <form
              id={`smart-food-${form.role}-login-form`}
              name={`smart-food-${form.role}-login-form`}
              onSubmit={submit}
              className="space-y-4"
              autoComplete="off"
            >
              {mode === 'register' && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Full name</label>
                  <input value={form.full_name} onChange={(event) => handleChange('full_name', event.target.value)} className="input-shell" placeholder="Your full name" />
                </div>
              )}

              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Mail size={15} />Email</label>
                <div className="relative">
                  <input
                    key={form.role}
                    type="text"
                    inputMode="email"
                    name={`smart-food-${form.role}-email`}
                    autoComplete="new-password"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={emailSuggestionsOpen && emailSuggestions.length > 0}
                    aria-controls={`smart-food-email-suggestions-${form.role}`}
                    value={form.email}
                    onFocus={() => {
                      setEmailSuggestions(readRoleEmailSuggestions(form.role))
                      setEmailSuggestionsOpen(true)
                    }}
                    onChange={(event) => {
                      handleChange('email', event.target.value)
                      setEmailSuggestionsOpen(true)
                    }}
                    onBlur={() => setEmailSuggestionsOpen(false)}
                    className="input-shell"
                    placeholder="you@example.com"
                    required
                  />
                  {emailSuggestionsOpen && emailSuggestions.length > 0 && (
                    <div
                      id={`smart-food-email-suggestions-${form.role}`}
                      role="listbox"
                      aria-label={`${form.role} email suggestions`}
                      className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                    >
                      {emailSuggestions
                        .filter((email) => email.toLowerCase().includes(form.email.trim().toLowerCase()))
                        .map((email) => (
                          <button
                            key={email}
                            type="button"
                            role="option"
                            aria-selected="false"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectEmailSuggestion(email)}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none"
                          >
                            {email}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {mode === 'register' && (
                <>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                    <select value={form.role} onChange={(event) => handleRoleChange(event.target.value as UserRole)} className="input-shell">
                      <option value="donor">Donor</option>
                      <option value="requester">Request Food / Receiver</option>
                      <option value="volunteer">Volunteer</option>
                      <option value="ngo">NGO / Organization</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Organization name</label>
                    <input value={form.organization_name} onChange={(event) => handleChange('organization_name', event.target.value)} className="input-shell" placeholder="Restaurant / NGO / Community kitchen" />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Phone</label>
                    <input value={form.phone} onChange={(event) => handleChange('phone', event.target.value)} className="input-shell" placeholder="+91 98xxxxxxx" />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">City</label>
                    <input value={form.city} onChange={(event) => handleChange('city', event.target.value)} className="input-shell" placeholder="Coimbatore" />
                  </div>
                </>
              )}

              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><LockKeyhole size={15} />Password</label>
                <input
                  type="password"
                  name={`smart-food-${form.role}-password`}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => handleChange('password', event.target.value)}
                  className="input-shell"
                  placeholder="••••••••"
                  required={mode === 'register'}
                />
              </div>

              {message && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>
              )}

              <button type="submit" className="primary-btn w-full px-4 py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-70" disabled={loading}>
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <LoaderCircle className="animate-spin" size={16} />
                    {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                  </span>
                ) : <span className="inline-flex items-center justify-center gap-2">{mode === 'login' ? <LogIn size={17} /> : <Plus size={17} />}{mode === 'login' ? 'Log in' : 'Create account'}</span>}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-600">
              <button type="button" onClick={() => navigate('/forgot-password')} className="inline-flex items-center gap-1 font-medium text-[#1d4d3d] hover:underline"><KeyRound size={14} />Forgot password?</button>
              <p>
                {mode === 'login' ? 'New here?' : 'Already joined?'}{' '}
                <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="font-semibold text-[#1d4d3d] hover:underline">
                  {mode === 'login' ? 'Sign Up' : 'Sign in'}
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    try {
      const response = await apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setMessage(response.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f7f1] p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1d4d3d]">Account</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">Forgot password</h2>
          </div>
          <button type="button" onClick={() => navigate('/auth')} className="secondary-btn inline-flex items-center gap-1 px-3 py-2 text-sm font-medium"><ArrowRight className="rotate-180" size={14} />Back</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Mail size={15} />Email address</label>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="input-shell" placeholder="you@example.com" required />
          </div>

          {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

          <button type="submit" className="primary-btn w-full px-4 py-3 text-base font-semibold disabled:opacity-70" disabled={loading}>
            {loading ? 'Sending...' : 'Send recovery instructions'}
          </button>
        </form>
      </div>
    </div>
  )
}

function DashboardPage({ user, onLogout, onUserUpdate }: { user: SessionUser; onLogout: () => void; onUserUpdate: (user: SessionUser) => void }) {
  const [overview, setOverview] = useState<DashboardSummary | null>(null)
  const [donations, setDonations] = useState<Donation[]>([])
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [deliveryTasks, setDeliveryTasks] = useState<DeliveryTask[]>([])
  const [deliveryIssues, setDeliveryIssues] = useState<DeliveryIssue[]>([])
  const [donationCancellations, setDonationCancellations] = useState<DonationCancellation[]>([])
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [needs, setNeeds] = useState<CommunityNeed[]>([])
  const [loading, setLoading] = useState(true)
  const [dataLoadError, setDataLoadError] = useState('')
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notificationActionMessage, setNotificationActionMessage] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const notificationAnchorRef = useRef<HTMLButtonElement>(null)
  const notificationPanelRef = useRef<HTMLDivElement>(null)
  const [notificationPosition, setNotificationPosition] = useState({ top: 0, right: 16 })

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const canBrowseDonations = user.role !== 'volunteer'
      const canViewRequests = user.role !== 'volunteer'
      const canViewNeeds = user.role === 'donor' || user.role === 'ngo' || user.role === 'admin'
      const canViewDeliveryTasks = user.role === 'volunteer' || user.role === 'ngo'
      const canViewCancellations = user.role === 'ngo'
      const [overviewResponse, donationResponse, notificationResponse, requestResponse, needResponse, deliveryResponse, issueResponse] = await Promise.all([
        apiRequest('/dashboard/overview'),
        canBrowseDonations ? apiRequest('/donations') : Promise.resolve({ donations: [] }),
        apiRequest('/notifications'),
        canViewRequests ? apiRequest('/donation-requests') : Promise.resolve({ requests: [] }),
        canViewNeeds ? apiRequest('/community-needs') : Promise.resolve({ needs: [] }),
        canViewDeliveryTasks ? apiRequest('/delivery-tasks') : Promise.resolve({ tasks: [] }),
        user.role === 'donor' ? apiRequest('/delivery-issues') : Promise.resolve({ issues: [] }),
      ])

      setOverview(overviewResponse)
      setDonations(donationResponse.donations || [])
      setNotifications(notificationResponse.notifications || [])
      setRequests(requestResponse.requests || [])
      setNeeds(needResponse.needs || [])
      setDeliveryTasks(deliveryResponse.tasks || [])
      setDeliveryIssues(issueResponse.issues || [])
      setDataLoadError('')

      if (canViewCancellations) {
        try {
          const cancellationResponse = await apiRequest('/donation-cancellations')
          setDonationCancellations(cancellationResponse.cancellations || [])
        } catch (error) {
          console.error(error)
          setDataLoadError(error instanceof Error
            ? `Some cancellation coordination data could not be loaded: ${error.message}`
            : 'Some cancellation coordination data could not be loaded.')
        }
      } else {
        setDonationCancellations([])
      }
    } catch (error) {
      console.error(error)
      setDataLoadError(error instanceof Error
        ? `Dashboard data could not be refreshed: ${error.message}`
        : 'Dashboard data could not be refreshed.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [user.role])

  useEffect(() => {
    void loadData()
    if (user.role !== 'ngo') return
    const refreshId = window.setInterval(() => {
      void loadData(false)
    }, 5000)
    return () => window.clearInterval(refreshId)
  }, [loadData, user.role])

  useEffect(() => {
    if (user.role !== 'donor') return
    const refreshId = window.setInterval(() => {
      void loadData(false)
    }, 5000)
    return () => window.clearInterval(refreshId)
  }, [loadData, user.role])

  const unreadCount = notifications.filter((item) => item.read_at === null).length
  const reloadDashboardData = () => loadData(false)

  const markRead = async (notificationId: string) => {
    try {
      await apiRequest(`/notifications/${notificationId}/read`, { method: 'POST' })
      setNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item))
    } catch (error) {
      console.error(error)
    }
  }

  const markAllRead = async () => {
    try {
      await apiRequest('/notifications/read-all', { method: 'POST' })
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })))
    } catch (error) {
      console.error(error)
    }
  }

  const deleteNotification = async (notification: NotificationItem) => {
    if (!window.confirm('Delete this notification?')) return
    setNotificationActionMessage('')
    try {
      await apiRequest(`/notifications/${encodeURIComponent(notification.id)}`, { method: 'DELETE' })
      setNotifications((current) => current.filter((item) => item.id !== notification.id))
    } catch (error) {
      setNotificationActionMessage(error instanceof Error ? error.message : 'Unable to delete notification')
    }
  }

  const clearAllNotifications = async () => {
    if (!notifications.length || !window.confirm('Delete all of your notifications? This will not delete donations, requests, or delivery records.')) return
    setNotificationActionMessage('')
    try {
      await apiRequest('/notifications', { method: 'DELETE' })
      setNotifications([])
    } catch (error) {
      setNotificationActionMessage(error instanceof Error ? error.message : 'Unable to clear notifications')
    }
  }

  useEffect(() => {
    if (!notificationOpen) {
      return
    }

    const updatePosition = () => {
      const anchor = notificationAnchorRef.current
      if (!anchor) return
      const bounds = anchor.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const panelWidth = Math.min(320, viewportWidth - 32)
      const maxRight = Math.max(16, viewportWidth - panelWidth - 16)
      setNotificationPosition({
        top: Math.max(16, Math.min(bounds.bottom + 8, window.innerHeight - 120)),
        right: Math.min(Math.max(16, viewportWidth - bounds.right), maxRight),
      })
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!notificationAnchorRef.current?.contains(target) && !notificationPanelRef.current?.contains(target)) {
        setNotificationOpen(false)
      }
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationOpen(false)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [notificationOpen])

  const navItems = useMemo(() => {
    if (user.role === 'donor') {
      return [
        { label: 'Overview', href: '#overview', icon: LayoutDashboard },
        { label: 'My donations', href: '#donations', icon: HandHeart },
        { label: 'Requests', href: '#food-contributions', icon: ClipboardList },
      ]
    }
    if (user.role === 'requester') {
      return [
        { label: 'Overview', href: '#overview', icon: LayoutDashboard },
        { label: 'Available food', href: '#marketplace', icon: Utensils },
        { label: 'My requests', href: '#requests', icon: ClipboardList },
      ]
    }
    if (user.role === 'volunteer') {
      return [
        { label: 'Overview', href: '#overview', icon: LayoutDashboard },
        { label: 'Delivery tasks', href: '#tasks', icon: ClipboardList },
        { label: 'My deliveries', href: '#my-deliveries', icon: Truck },
      ]
    }
    if (user.role === 'ngo') {
      return [
        { label: 'Overview', href: '#overview', icon: LayoutDashboard },
        { label: 'Volunteer availability', href: '#volunteer-availability', icon: CalendarClock },
        { label: 'Food requests', href: '#requests', icon: ClipboardList },
        { label: 'Deliveries', href: '#deliveries', icon: Truck },
        { label: 'Organization profile', href: '#profile', icon: UserRound },
        { label: 'Community needs', href: '#needs', icon: HeartHandshake },
      ]
    }
    return [
      { label: 'Overview', href: '#overview', icon: LayoutDashboard },
      { label: 'Users', href: '#users', icon: Users },
      { label: 'Reports', href: '#reports', icon: BarChart3 },
    ]
  }, [user.role])

  return (
    <div className="min-h-screen bg-[#f4f7f1] text-slate-900 lg:h-screen lg:overflow-hidden">
      <div className="mx-auto flex w-full max-w-none flex-col gap-6 px-4 py-5 sm:px-6 lg:h-full lg:flex-row lg:items-stretch lg:overflow-hidden lg:px-8 lg:py-0">
        <aside className="card-surface max-h-[calc(100vh-2.5rem)] w-full shrink-0 overflow-y-auto overscroll-contain rounded-[28px] p-4 lg:sticky lg:top-0 lg:h-screen lg:max-h-screen lg:w-[280px]">
          <div className="flex items-center justify-between lg:block">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1d4d3d] text-white">
                <Leaf size={20} />
              </div>
              <div>
                <p className="text-base font-bold">{user.organization_name || 'Smart Food'}</p>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{roleDisplayName(user.role)}</p>
              </div>
            </div>
            <button type="button" aria-label={mobileNavOpen ? 'Close dashboard navigation' : 'Open dashboard navigation'} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)} className="rounded-xl border border-slate-200 p-2 lg:hidden">
              {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>

          <div className={`mt-8 space-y-2 ${mobileNavOpen ? 'block' : 'hidden'} lg:block`}>
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={(event) => {
                    event.preventDefault()
                    setMobileNavOpen(false)
                    document.getElementById(item.href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-[#edf8ef] hover:text-[#1d4d3d]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#edf8ef] text-[#1d4d3d]">
                    <Icon size={15} />
                  </div>
                  {item.label}
                </a>
              )
            })}
          </div>

          <div className="mt-10 rounded-3xl bg-[#ecfdf5] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#1d4d3d]">
                <UserRound size={18} />
              </div>
              <div>
                <p className="font-semibold text-slate-900">{user.full_name}</p>
                <p className="text-xs text-slate-600">{user.email}</p>
              </div>
            </div>
          </div>

          <button onClick={onLogout} type="button" className="secondary-btn mt-8 flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold">
            <LogOut size={16} /> Log out
          </button>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 space-y-6 overflow-visible lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pb-5">
          <header className="card-surface relative rounded-[28px] p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Dashboard</p>
                <h1 className="mt-2 text-3xl font-black text-slate-900">Welcome back, {user.full_name.split(' ')[0]}</h1>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link to="/" className="secondary-btn px-3 py-2 text-sm font-medium">Role selection</Link>
                  <button ref={notificationAnchorRef} type="button" aria-label={`Notifications, ${unreadCount} unread`} aria-expanded={notificationOpen} aria-haspopup="dialog" onClick={() => setNotificationOpen((value) => !value)} className="relative flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    <Bell size={15} />
                    <span className="sr-only">Notifications</span>
                    {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
                  </button>
                </div>

                {notificationOpen && createPortal(
                  <div
                    ref={notificationPanelRef}
                    role="dialog"
                    aria-label="Notifications"
                    style={{ top: notificationPosition.top, right: notificationPosition.right, maxHeight: Math.max(96, window.innerHeight - notificationPosition.top - 16) }}
                    className="fixed z-[1000] flex w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.2)]"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-semibold text-slate-900">Notifications</p>
                      <div className="flex gap-3">
                        <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-medium text-[#1d4d3d]"><CheckCircle2 size={13} />Mark all as read</button>
                        <button type="button" onClick={() => void clearAllNotifications()} disabled={!notifications.length} className="inline-flex items-center gap-1 text-xs font-medium text-red-700 disabled:opacity-50"><Trash2 size={13} />Clear all</button>
                      </div>
                    </div>
                    {notificationActionMessage && <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{notificationActionMessage}</p>}
                    <div className="min-h-0 space-y-2 overflow-y-auto">
                      {notifications.length ? (
                        notifications.map((item) => (
                          <div key={item.id} className={`rounded-2xl border p-3 ${item.read_at ? 'border-slate-200 bg-slate-50' : 'border-[#d4f0dd] bg-[#edfdf4]'}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-slate-800">{item.message}</p>
                                <p className="mt-1 text-[11px] text-slate-500">{new Date(item.created_at).toLocaleString()}</p>
                                {item.type === 'delivery' && item.link.startsWith('/delivery-feedback/') && (
                                  <Link to={item.link} onClick={() => { setNotificationOpen(false); void markRead(item.id) }} className="mt-2 inline-flex text-xs font-semibold text-[#1d4d3d] underline"><span className="inline-flex items-center gap-1"><MessageCircle size={14} />Leave delivery feedback</span></Link>
                                )}
                                {user.role === 'donor' && item.type === 'feedback' && item.link.startsWith('/dashboard/donor#donation-feedback-') && (
                                  <Link
                                    to={item.link}
                                    onClick={() => {
                                      setNotificationOpen(false)
                                      void markRead(item.id)
                                      void loadData(false)
                                    }}
                                    className="mt-2 inline-flex text-xs font-semibold text-[#1d4d3d] underline"
                                  >
                                    <span className="inline-flex items-center gap-1"><Heart size={14} />View donation feedback</span>
                                  </Link>
                                )}
                                {user.role === 'ngo' && item.type === 'feedback' && item.link === '/dashboard/ngo#delivery-feedback' && (
                                  <Link
                                    to={item.link}
                                    onClick={() => {
                                      setNotificationOpen(false)
                                      void markRead(item.id)
                                      void loadData(false)
                                    }}
                                    className="mt-2 inline-flex text-xs font-semibold text-[#1d4d3d] underline"
                                  >
                                    <span className="inline-flex items-center gap-1"><ClipboardList size={14} />Review delivery feedback</span>
                                  </Link>
                                )}
                              </div>
                              {!item.read_at && (
                                <button type="button" onClick={() => markRead(item.id)} aria-label="Mark notification as read" className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1d4d3d]"><CheckCircle2 size={15} /></button>
                              )}
                            </div>
                            <div className="mt-2 flex justify-end">
                              <button type="button" onClick={() => void deleteNotification(item)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline"><Trash2 size={13} />Delete notification</button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No notifications yet.</div>
                      )}
                    </div>
                  </div>,
                  document.body,
                )}
              </div>
            </div>
          </header>

          {dataLoadError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{dataLoadError}</p>}

          {loading ? (
            <div className="card-surface rounded-[28px] p-8 text-center text-slate-600">Loading dashboard…</div>
          ) : user.role === 'donor' ? (
            <DonorDashboard
              user={user}
              overview={overview}
              donations={donations}
              requests={requests}
              needs={needs}
              deliveryIssues={deliveryIssues}
              onReload={reloadDashboardData}
              onDonationCreated={(donation) => setDonations((current) => (
                current.some((item) => item.id === donation.id) ? current : [donation, ...current]
              ))}
            />
          ) : user.role === 'admin' ? (
            <AdminDashboard overview={overview} donations={donations} requests={requests} needs={needs} />
          ) : (
            <NgoDashboard
              key={user.id}
              user={user}
              overview={overview}
              donations={donations}
              requests={requests}
              deliveryTasks={deliveryTasks}
              donationCancellations={donationCancellations}
              needs={needs}
              onReload={reloadDashboardData}
              onUserUpdate={onUserUpdate}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function DonorDashboard({ user, overview, donations, requests, needs, deliveryIssues, onReload, onDonationCreated }: { user: SessionUser; overview: DashboardSummary | null; donations: Donation[]; requests: RequestItem[]; needs: CommunityNeed[]; deliveryIssues: DeliveryIssue[]; onReload: () => Promise<void>; onDonationCreated: (donation: Donation) => void }) {
  const [message, setMessage] = useState('')
  const [editingDonationId, setEditingDonationId] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageMessage, setImageMessage] = useState('')
  const [failedPreviewUrl, setFailedPreviewUrl] = useState('')
  const [savingDonation, setSavingDonation] = useState(false)
  const [deletingDonationId, setDeletingDonationId] = useState<string | null>(null)
  const [deletingDonation, setDeletingDonation] = useState(false)
  const [cancellingDonationId, setCancellingDonationId] = useState<string | null>(null)
  const [cancellationReason, setCancellationReason] = useState('')
  const [cancellationDetails, setCancellationDetails] = useState('')
  const [cancellingDonation, setCancellingDonation] = useState(false)
  const [needPickupLocations, setNeedPickupLocations] = useState<Record<string, string>>({})
  const [requestContributionForms, setRequestContributionForms] = useState<Record<string, { donation_id: string; quantity: string }>>({})
  const [donationCertificates, setDonationCertificates] = useState<DonationCertificate[]>([])
  const [milestoneCertificates, setMilestoneCertificates] = useState<DonationCertificate[]>([])
  const [completedDonationCount, setCompletedDonationCount] = useState(0)
  const [nextMilestone, setNextMilestone] = useState<DonationMilestoneProgress | null>(null)
  const [certificateDataLoaded, setCertificateDataLoaded] = useState(false)
  const [certificatesLoading, setCertificatesLoading] = useState(true)
  const [certificatesError, setCertificatesError] = useState('')
  const [certificateRetryToken, setCertificateRetryToken] = useState(0)
  const [selectedCertificate, setSelectedCertificate] = useState<DonationCertificate | null>(null)
  const [downloadingCertificateId, setDownloadingCertificateId] = useState('')
  const savingDonationRef = useRef(false)
  const submissionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    let fetching = false
    setMilestoneCertificates([])
    setDonationCertificates([])
    setCompletedDonationCount(0)
    setNextMilestone(null)
    setCertificateDataLoaded(false)
    setCertificatesLoading(true)
    setCertificatesError('')
    const fetchCertificates = async () => {
      if (fetching) return
      fetching = true
      try {
        const response = await apiRequest('/donor/certificates')
        if (!active) return
        const earnedMilestones = ((response.milestone_certificates || []) as DonationCertificate[])
          .filter((certificate) => certificate.certificate_type === 'milestone' && Boolean(certificate.milestone))
        const earnedDonations = ((response.donation_certificates || []) as DonationCertificate[])
          .filter((certificate) => certificate.certificate_type === 'donation' || Boolean(certificate.donation_id && !certificate.milestone))
        setDonationCertificates(earnedDonations)
        setMilestoneCertificates(earnedMilestones)
        setCompletedDonationCount(Number(response.completed_donations) || 0)
        setNextMilestone((response.next_milestone as DonationMilestoneProgress | null) || null)
        setCertificateDataLoaded(true)
        setCertificatesError('')
      } catch (error) {
        if (active) setCertificatesError(error instanceof Error ? error.message : 'Unable to load certificates.')
      } finally {
        fetching = false
        if (active) setCertificatesLoading(false)
      }
    }

    void fetchCertificates()
    const intervalId = window.setInterval(() => void fetchCertificates(), 30000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [certificateRetryToken, user.id])

  const openCertificate = (certificate: DonationCertificate) => {
    setSelectedCertificate(certificate)
  }

  const closeCertificate = () => {
    setSelectedCertificate(null)
  }

  const printCertificate = (certificate: DonationCertificate) => {
    if (isDonorCertificate(certificate)) {
      const milestoneDonation = donationCertificates.find((item) => item.donation_id === certificate.donation_id)
      if (!openCertificatePrintWindow(createDonationCertificateHtml(certificate, milestoneDonation), certificate.certificate_id)) {
        setCertificatesError('Your browser blocked the certificate print window. Allow pop-ups to print or save this certificate.')
      }
      return
    }
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setCertificatesError('Your browser blocked the print window. Allow pop-ups to print this certificate.')
      return
    }
    printWindow.opener = null
    const imageUrl = certificateDataUrl(certificate)
    printWindow.document.write(`<!doctype html><html><head><title>${escapeXml(certificate.title)}</title><style>@page{size:landscape;margin:0}html,body{margin:0;width:100%;height:100%;background:white}img{display:block;width:100%;height:100%;object-fit:contain}@media print{img{width:100vw;height:100vh}}</style></head><body><img alt="${escapeXml(certificate.title)} certificate" src="${imageUrl}"><script>window.onload=()=>window.print()<\/script></body></html>`)
    printWindow.document.close()
  }

  const downloadCertificatePdf = async (certificate: DonationCertificate) => {
    setDownloadingCertificateId(certificate.id)
    setCertificatesError('')
    try {
      const pdf = await createCertificatePdf(createCertificateSvg(certificate))
      await requestCertificateDownload(certificate.certificate_id, pdf)
    } catch (error) {
      setCertificatesError(error instanceof Error ? error.message : 'Unable to generate the certificate PDF.')
    } finally {
      setDownloadingCertificateId('')
    }
  }

  const [form, setForm] = useState({
    food_name: '',
    category: 'Meals',
    description: '',
    quantity: '10',
    quantity_unit: 'servings',
    servings: '10',
    is_veg: 'true',
    pickup_location: '',
    city: 'Coimbatore',
    available_until: '',
    pickup_available_until: '',
    preparation_time: '',
    handling_instructions: '',
    image_url: '',
    image_source: '',
  })
  const currentFoodName = form.food_name.trim()
  const donorUploadedImage = isDonorUploadedImage(form)
  const [searchedFoodImage, setSearchedFoodImage] = useState<{ foodName: string; imageUrl: string | null }>({ foodName: '', imageUrl: null })
  useEffect(() => {
    let active = true
    if (!currentFoodName || donorUploadedImage) {
      setSearchedFoodImage({ foodName: currentFoodName, imageUrl: null })
      return () => { active = false }
    }

    const timeoutId = window.setTimeout(() => {
      void searchFoodImage(currentFoodName).then((imageUrl) => {
        if (active) setSearchedFoodImage({ foodName: currentFoodName, imageUrl })
      })
    }, 400)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [currentFoodName, donorUploadedImage])

  const donorDonationIds = new Set(donations.map((donation) => donation.id))
  const supplierRequests = requests.filter((request) => !request.multi_contribution && request.donation_id && donorDonationIds.has(request.donation_id))
  const openFoodRequests = requests.filter((request) =>
    request.multi_contribution || (
      !request.multi_contribution
      && request.donation_id
      && !donorDonationIds.has(request.donation_id)
      && !['completed', 'fulfilled', 'rejected', 'cancelled'].includes(request.status)
    ),
  )
  const previewImage = !currentFoodName
    ? ''
    : donorUploadedImage
      ? getDonationImage(form)
      : searchedFoodImage.foodName === currentFoodName && searchedFoodImage.imageUrl
        ? searchedFoodImage.imageUrl
        : getDonationImage(form)

  const fillFormForEdit = (donation: Donation) => {
    setEditingDonationId(donation.id)
    setForm({
      food_name: donation.food_name,
      category: donation.category,
      description: donation.description || '',
      quantity: String(donation.quantity),
      quantity_unit: donation.quantity_unit,
      servings: String(donation.servings ?? donation.quantity),
      is_veg: String(Boolean(donation.is_veg)),
      pickup_location: donation.pickup_location,
      city: donation.city,
      available_until: dateTimeInputValue(donation.available_until),
      pickup_available_until: dateTimeInputValue(donation.pickup_available_until),
      preparation_time: dateTimeInputValue(donation.preparation_time),
      handling_instructions: donation.handling_instructions || '',
      image_url: donation.image_url || '',
      image_source: donation.image_source || (donation.image_url ? 'legacy' : ''),
    })
    setImageMessage('')
    setFailedPreviewUrl('')
    document.getElementById('create-donation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const updateField = (field: string, value: string) => setForm((current) => ({ ...current, [field]: value }))

  const handleFoodNameChange = (foodName: string) => {
    const normalizedFoodName = foodName.trim()
    setSearchedFoodImage({ foodName: normalizedFoodName, imageUrl: null })
    setForm((current) => ({
      ...current,
      food_name: foodName,
      ...(isDonorUploadedImage(current) ? {} : { image_url: '', image_source: '' }),
    }))
    setFailedPreviewUrl('')
    setImageMessage('')
  }

  const handleFoodCategoryChange = (category: string) => {
    setForm((current) => {
      return { ...current, category }
    })
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileInput = event.currentTarget
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMessage('Choose a JPG, PNG, or WebP food photo.')
      fileInput.value = ''
      return
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setMessage('Food photos must be 16 MB or smaller.')
      fileInput.value = ''
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    setImageUploading(true)
    try {
      const response = await apiRequest('/upload', { method: 'POST', body: formData })
      if (typeof response.url !== 'string' || !response.url.startsWith('/uploads/')) {
        throw new Error('The server did not return a saved image path.')
      }
      setForm((current) => ({ ...current, image_url: response.url, image_source: 'uploaded' }))
      setImageMessage('')
      setFailedPreviewUrl('')
      setMessage('Food image uploaded successfully.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to upload image')
    } finally {
      setImageUploading(false)
      fileInput.value = ''
    }
  }

  const submitDonation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    if (savingDonationRef.current) {
      return
    }

    if (!form.food_name.trim() || !form.category || !form.pickup_location.trim() || !form.city.trim() || !form.available_until || !form.preparation_time) {
      setMessage('Please complete the food name, category, preparation time, expiry time, location, and other required fields.')
      return
    }
    if (!Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0 || !Number.isFinite(Number(form.servings)) || Number(form.servings) <= 0) {
      setMessage('Quantity and estimated servings must be greater than zero.')
      return
    }
    const preparationTime = Date.parse(form.preparation_time)
    const foodExpiry = Date.parse(form.available_until)
    if (!Number.isFinite(preparationTime) || !Number.isFinite(foodExpiry) || foodExpiry <= preparationTime) {
      setMessage('Food expiry date and time must be valid and later than the preparation time.')
      return
    }
    if (foodExpiry <= Date.now()) {
      setMessage('Food expiry date and time must be in the future.')
      return
    }
    if (form.pickup_available_until) {
      const pickupDeadline = Date.parse(form.pickup_available_until)
      if (!Number.isFinite(pickupDeadline) || pickupDeadline <= preparationTime) {
        setMessage('Pickup Available Until must be a valid date and time after the preparation time.')
        return
      }
      if (pickupDeadline > foodExpiry) {
        setMessage('Pickup Available Until cannot be later than the Food Expiry Date & Time.')
        return
      }
    }
    if (imageUploading) {
      setMessage('Please wait for the image upload to finish before saving.')
      return
    }

    savingDonationRef.current = true
    setSavingDonation(true)
    try {
      const donorUploadedImage = isDonorUploadedImage(form)
      const searchedImageUrl = donorUploadedImage ? '' : await searchFoodImage(form.food_name)
      const imageUrl = donorUploadedImage
        ? form.image_url || ''
        : searchedImageUrl || form.image_url || ''
      const imageSource = donorUploadedImage ? 'uploaded' : imageUrl ? 'search' : ''
      if (!donorUploadedImage) {
        setForm((current) => current.food_name.trim() === form.food_name.trim()
          ? { ...current, image_url: imageUrl || '', image_source: imageSource }
          : current)
      }

      const payload = {
        ...form,
        food_name: form.food_name.trim(),
        category: form.category.trim(),
        image_url: imageUrl,
        image_source: imageSource,
        pickup_location: form.pickup_location.trim(),
        city: form.city.trim(),
        quantity: Number(form.quantity),
        servings: Number(form.servings),
        is_veg: form.is_veg === 'true',
        preparation_time: dateTimeInputToIso(form.preparation_time),
        available_until: dateTimeInputToIso(form.available_until),
        pickup_available_until: dateTimeInputToIso(form.pickup_available_until || form.available_until),
      }

      if (editingDonationId) {
        const response = await apiRequest(`/donations/${editingDonationId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        if (!isDonationRecord(response.donation) || response.donation.donor_id !== user.id) {
          throw new Error('The server did not confirm this donation update.')
        }
        submissionKeyRef.current = null
        setMessage('Donation updated successfully.')
      } else {
        submissionKeyRef.current ??= crypto.randomUUID()
        const response = await apiRequest('/donations', {
          method: 'POST',
          headers: { 'Idempotency-Key': submissionKeyRef.current },
          body: JSON.stringify(payload),
        })
        if (!isDonationRecord(response.donation) || response.donation.donor_id !== user.id) {
          throw new Error('The server did not confirm that this donation was saved to your account.')
        }
        onDonationCreated(response.donation)
        setMessage('Donation created successfully.')
        submissionKeyRef.current = null
      }

      setEditingDonationId(null)
      setForm({
        food_name: '',
        category: 'Meals',
        description: '',
        quantity: '10',
        quantity_unit: 'servings',
        servings: '10',
        is_veg: 'true',
        pickup_location: '',
        city: 'Coimbatore',
        available_until: '',
        pickup_available_until: '',
        preparation_time: '',
        handling_instructions: '',
        image_url: '',
        image_source: '',
      })
      setImageMessage('')
      setFailedPreviewUrl('')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save donation')
    } finally {
      savingDonationRef.current = false
      setSavingDonation(false)
    }
  }

  const deleteDonation = async () => {
    if (!deletingDonationId || deletingDonation) {
      return
    }
    setDeletingDonation(true)
    try {
      await apiRequest(`/donations/${deletingDonationId}`, { method: 'DELETE' })
      if (editingDonationId === deletingDonationId) {
        setEditingDonationId(null)
        setForm({
          food_name: '', category: 'Meals', description: '', quantity: '10', quantity_unit: 'servings',
          servings: '10', is_veg: 'true', pickup_location: '', city: 'Coimbatore', available_until: '',
          pickup_available_until: '', preparation_time: '', handling_instructions: '', image_url: '', image_source: '',
        })
      }
      setDeletingDonationId(null)
      setMessage('Donation deleted successfully.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete donation')
    } finally {
      setDeletingDonation(false)
    }
  }

  const cancelEdit = () => {
    setEditingDonationId(null)
    setForm({
      food_name: '', category: 'Meals', description: '', quantity: '10', quantity_unit: 'servings',
      servings: '10', is_veg: 'true', pickup_location: '', city: 'Coimbatore', available_until: '',
      pickup_available_until: '', preparation_time: '', handling_instructions: '', image_url: '', image_source: '',
    })
    setImageMessage('')
    setFailedPreviewUrl('')
  }

  const cancelDonation = async () => {
    const donationId = cancellingDonationId
    const reason = cancellationReason === 'Other' ? cancellationDetails.trim() : cancellationReason
    if (!donationId || !reason || cancellingDonation) return
    setCancellingDonation(true)
    try {
      await apiRequest(`/donations/${encodeURIComponent(donationId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      setCancellingDonationId(null)
      setCancellationReason('')
      setCancellationDetails('')
      setMessage('Donation cancelled. The NGO and any assigned volunteer have been notified.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to cancel donation')
    } finally {
      setCancellingDonation(false)
    }
  }

  const contributeToRequest = async (requestItem: RequestItem) => {
    const contribution = requestContributionForms[requestItem.id]
    if (!contribution?.donation_id || !contribution.quantity) {
      setMessage('Select one of your donations and enter a contribution quantity.')
      return
    }
    try {
      await apiRequest(`/donation-requests/${requestItem.id}/contributions`, {
        method: 'POST',
        body: JSON.stringify({
          donation_id: contribution.donation_id,
          quantity: Number(contribution.quantity),
        }),
      })
      setMessage('Your food contribution was recorded for delivery coordination.')
      setRequestContributionForms((current) => ({ ...current, [requestItem.id]: { donation_id: '', quantity: '' } }))
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to contribute to this food request')
    }
  }

  const respondToNeed = async (need: CommunityNeed) => {
    try {
      const defaultPickupLocation = user.address
        ? `${user.address}${user.city ? `, ${user.city}` : ''}`
        : user.city || ''
      const pickupLocation = needPickupLocations[need.id] ?? need.pickup_location ?? defaultPickupLocation
      await apiRequest(`/community-needs/${need.id}/respond`, {
        method: need.has_responded ? 'PATCH' : 'POST',
        body: JSON.stringify({
          quantity: need.required_quantity,
          pickup_location: pickupLocation,
        }),
      })
      setMessage(need.has_responded
        ? 'Your pickup location was updated.'
        : 'Your response was recorded and is awaiting delivery coordination.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to respond to this need')
    }
  }

  const updateRequestStatus = async (requestId: string, status: 'approved' | 'rejected') => {
    try {
      await apiRequest(`/donation-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update request status')
    }
  }

  const stats = [
    { label: 'Total donations', value: overview?.stats.total_donations ?? 0, accent: 'bg-[#edf8ef] text-[#1d4d3d]' },
    { label: 'Completed', value: overview?.stats.completed_donations ?? 0, accent: 'bg-[#fff4df] text-[#b45309]' },
    { label: 'Pending requests', value: overview?.stats.pending_requests ?? 0, accent: 'bg-[#eff6ff] text-[#1d4ed8]' },
    { label: 'Meals contributed', value: overview?.stats.estimated_meals ?? 0, accent: 'bg-[#fdf2f8] text-[#be185d]' },
  ]
  const earnedCertificates = milestoneCertificates
  const donorMilestones = [
    { key: 'first_donation', target: 1, label: 'First Donation' },
    { key: 'community_hero', target: 5, label: 'Community Hero' },
    { key: 'food_donation_champion_15', target: 15, label: 'Food Donation Champion' },
    { key: 'humanity_ambassador', target: 25, label: 'Humanity Ambassador' },
  ]
  const earnedCertificateFor = (target: number) => earnedCertificates.find(
    (certificate) => Number(certificate.completed_donations ?? certificate.completed_deliveries) === target,
  )

  return (
    <div id="overview" className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, accent }) => (
          <div key={label} className="metric-card section-shell rounded-[28px] p-5">
            <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>
              <CheckCircle2 size={18} />
            </div>
            <p className="text-3xl font-black text-slate-900">{value}</p>
            <p className="mt-2 text-sm text-slate-600">{label}</p>
          </div>
        ))}
      </section>

      {deliveryIssues.length > 0 && (
        <section className="section-shell rounded-[28px] p-5">
          <h2 className="text-xl font-bold text-slate-900">Issues linked to your donations</h2>
          <div className="mt-4 space-y-3">
            {deliveryIssues.map((issue) => (
              <Link key={issue.id} to={`/delivery-issues/${encodeURIComponent(issue.id)}`} className="block rounded-2xl border border-amber-200 bg-amber-50/50 p-4 hover:bg-amber-50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{issue.category || 'Delivery'} · {formatStatus(issue.status)}</p>
                  <span className="text-xs text-slate-500">Issue {issue.id}</span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{issue.description}</p>
                {issue.resolution_note && <p className="mt-2 text-sm text-slate-600">NGO response: {issue.resolution_note}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section-shell rounded-[28px] p-5" aria-labelledby="donor-donation-certificates-heading">
        <h3 id="donor-donation-certificates-heading" className="text-xl font-bold text-slate-900">My Donation Certificates</h3>
        <p className="mt-2 text-sm text-slate-600">Based on {completedDonationCount} completed donation{completedDonationCount === 1 ? '' : 's'} in your saved donation records.</p>
        {certificatesLoading ? (
          <p role="status" className="py-5 text-sm text-slate-600">Loading donation certificates…</p>
        ) : (
          <>
            {certificatesError && (
              <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                <span>{certificatesError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setCertificatesLoading(true)
                    setCertificatesError('')
                    setCertificateRetryToken((current) => current + 1)
                  }}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              </div>
            )}
            {certificateDataLoaded && (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {donorMilestones.map((milestone) => {
                    const certificate = earnedCertificateFor(milestone.target)
                    const earned = completedDonationCount >= milestone.target && Boolean(certificate)
                    const remaining = Math.max(0, milestone.target - completedDonationCount)
                    return (
                      <article key={milestone.key} className={`rounded-2xl border p-4 ${earned ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                        <p className="text-sm font-bold text-slate-900">{milestone.label}</p>
                        <p className={`mt-1 text-xs ${earned ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {earned ? `Earned · ${certificateDate(certificate?.achievement_date || '')}` : `${remaining} more ${remaining === 1 ? 'donation' : 'donations'} needed`}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => certificate && openCertificate(certificate)}
                            disabled={!earned || !certificate}
                            className="secondary-btn px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Generate Certificate
                          </button>
                          <button
                            type="button"
                            onClick={() => certificate && void downloadCertificatePdf(certificate)}
                            disabled={!earned || !certificate || downloadingCertificateId === certificate.id}
                            className="primary-btn px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {downloadingCertificateId === certificate?.id ? 'Preparing PDF…' : 'Download Certificate'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  {nextMilestone ? (
                    <>
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-[#1d4d3d]">Next milestone</p>
                          <h4 className="mt-1 text-lg font-bold text-slate-900">{nextMilestone.title.replace(/ Certificate$/, '')}</h4>
                        </div>
                        <p className="text-sm font-semibold text-slate-700">
                          {nextMilestone.remaining_donations} more {nextMilestone.remaining_donations === 1 ? 'donation' : 'donations'} needed
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {Math.min(completedDonationCount, nextMilestone.required_donations)} of {nextMilestone.required_donations} completed donations
                      </p>
                      <div
                        className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200"
                        role="progressbar"
                        aria-label={`${nextMilestone.title} progress`}
                        aria-valuemin={0}
                        aria-valuemax={nextMilestone.required_donations}
                        aria-valuenow={Math.min(completedDonationCount, nextMilestone.required_donations)}
                      >
                        <div className="h-full rounded-full bg-[#1d4d3d] transition-[width] duration-500" style={{ width: `${nextMilestone.progress_percent}%` }} />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-[#1d4d3d]">All donation certificate milestones have been achieved.</p>
                  )}
                </div>

              </>
            )}
          </>
        )}
      </section>

      <section id="create-donation" className="grid gap-6">
        <div className="section-shell rounded-[28px] p-5">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">{editingDonationId ? <Pencil size={21} /> : <Plus size={21} />}{editingDonationId ? 'Edit donation' : 'Create a food donation'}</h2>
          <p className="mt-1 text-sm text-slate-500">Share food details and timing so the right organizations can respond quickly.</p>

          <form onSubmit={submitDonation} className="mt-5 grid w-full max-w-5xl gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Utensils size={15} />Food name</label>
              <input value={form.food_name} onChange={(event) => handleFoodNameChange(event.target.value)} className="input-shell" placeholder="Enter a food name" required disabled={savingDonation} />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Package size={15} />Category</label>
              <select value={form.category} onChange={(event) => handleFoodCategoryChange(event.target.value)} className="input-shell">
                <option>Meals</option>
                <option>Snacks</option>
                <option>Fruits</option>
                <option>Bakery</option>
                <option>Vegetables</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Veg / non-veg</label>
              <select value={form.is_veg} onChange={(event) => updateField('is_veg', event.target.value)} className="input-shell">
                <option value="true">Veg</option>
                <option value="false">Non-veg</option>
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Package size={15} />Quantity</label>
              <input type="number" min="1" value={form.quantity} onChange={(event) => updateField('quantity', event.target.value)} className="input-shell" required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Unit</label>
              <select value={form.quantity_unit} onChange={(event) => updateField('quantity_unit', event.target.value)} className="input-shell">
                <option>servings</option>
                <option>kg</option>
                <option>packets</option>
                <option>boxes</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">Description</label>
              <textarea value={form.description} onChange={(event) => updateField('description', event.target.value)} className="input-shell min-h-[100px]" placeholder="Freshly prepared, suitable for community meals." />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><CalendarDays size={15} />Preparation time</label>
              <input type="datetime-local" value={form.preparation_time} onChange={(event) => updateField('preparation_time', event.target.value)} className="input-shell" required />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Clock3 size={15} />Food Expiry Date &amp; Time</label>
              <input type="datetime-local" value={form.available_until} onChange={(event) => updateField('available_until', event.target.value)} className="input-shell" aria-describedby="food-expiry-help" required />
              <p id="food-expiry-help" className="mt-1 text-xs text-slate-500">Enter when this food should no longer be consumed, not your pickup availability.</p>
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><CalendarClock size={15} />Pickup Available Until</label>
              <input
                type="datetime-local"
                value={form.pickup_available_until}
                onChange={(event) => updateField('pickup_available_until', event.target.value)}
                className="input-shell"
                aria-describedby="pickup-deadline-help"
              />
              <p id="pickup-deadline-help" className="mt-1 text-xs text-slate-500">Last time a receiver or volunteer can collect this food. If left blank, the expiry time is used.</p>
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><MapPin size={15} />Pickup location</label>
              <input value={form.pickup_location} onChange={(event) => updateField('pickup_location', event.target.value)} className="input-shell" placeholder="MG Road, Coimbatore" required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">City</label>
              <input value={form.city} onChange={(event) => updateField('city', event.target.value)} className="input-shell" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Estimated servings</label>
              <input type="number" min="1" value={form.servings} onChange={(event) => updateField('servings', event.target.value)} className="input-shell" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">Handling instructions</label>
              <textarea value={form.handling_instructions} onChange={(event) => updateField('handling_instructions', event.target.value)} className="input-shell min-h-[90px]" placeholder="Keep refrigerated and transport carefully." />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Food photo
                <span className="ml-2 font-normal text-slate-500">JPG, PNG, or WebP (up to 16 MB)</span>
              </label>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageUpload} className="input-shell" disabled={imageUploading || savingDonation} />
              {imageUploading && <p className="mt-2 text-xs text-slate-500">Saving photo to this server...</p>}
              {previewImage && previewImage !== failedPreviewUrl ? (
                <div className="relative mt-3 h-28 w-full overflow-hidden rounded-2xl">
                  <img
                    src={previewImage}
                    alt={`${form.food_name || 'Food'} donation preview`}
                    className="h-full w-full object-cover"
                    onError={() => setFailedPreviewUrl(previewImage)}
                  />
                  {isDonorUploadedImage(form) && (
                    <span className="absolute inset-x-0 bottom-0 bg-slate-950/75 px-2 py-1 text-center text-xs font-semibold text-white">
                      Donor-uploaded photo
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex h-28 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
                  Food image unavailable
                </div>
              )}
              {imageMessage && <p className="mt-2 text-xs text-slate-500">{imageMessage}</p>}
            </div>

            {message && <div className={`md:col-span-2 rounded-2xl border px-4 py-3 text-sm ${/successfully|was submitted|thank you/i.test(message) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`} role={/successfully|was submitted|thank you/i.test(message) ? 'status' : 'alert'}>{message}</div>}

            <div className="md:col-span-2 flex justify-end gap-3">
              {editingDonationId && (
                <button type="button" onClick={cancelEdit} className="secondary-btn inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold" disabled={savingDonation}>
                  <X size={16} />Cancel edit
                </button>
              )}
              <button type="submit" className="primary-btn inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" disabled={savingDonation || imageUploading}>
                {savingDonation ? <LoaderCircle className="animate-spin" size={16} /> : editingDonationId ? <Save size={16} /> : <Plus size={16} />}
                {savingDonation ? 'Saving...' : editingDonationId ? 'Save changes' : 'Submit donation'}
              </button>
            </div>
          </form>
        </div>

      </section>

      <section id="food-contributions" className="section-shell rounded-[28px] p-5">
        <h2 className="text-2xl font-bold text-slate-900">Food requests from receivers</h2>
        <p className="mt-1 text-sm text-slate-600">Contribute from an available listing; the organization coordinates delivery with a volunteer.</p>
        {openFoodRequests.length ? (
          <div className="mt-5 space-y-3">
            {openFoodRequests.map((requestItem) => {
              const requestCategory = (requestItem.category || '').trim().toLocaleLowerCase()
              const requestFoodName = (requestItem.food_name || '').trim().toLocaleLowerCase()
              const matchingDonations = donations.filter((donation) => {
                const unitMatches = donation.quantity_unit.trim().toLocaleLowerCase()
                  === (requestItem.quantity_unit || '').trim().toLocaleLowerCase()
                const foodMatches = requestCategory
                  ? donation.category.trim().toLocaleLowerCase() === requestCategory
                    || donation.food_name.trim().toLocaleLowerCase() === requestFoodName
                  : donation.food_name.trim().toLocaleLowerCase() === requestFoodName
                    || donation.category.trim().toLocaleLowerCase() === requestFoodName
                return unitMatches && foodMatches
              })
              const eligibleDonations = matchingDonations.filter((donation) =>
                ['available', 'requested', 'accepted'].includes(donation.status)
                && (donation.available_quantity ?? donation.quantity) > 0,
              )
              const myContribution = requestItem.contributions?.find((item) => item.donor_id === user.id)
              const formState = requestContributionForms[requestItem.id] || { donation_id: '', quantity: '' }
              const selectedDonation = eligibleDonations.find((item) => item.id === formState.donation_id)
              const remainingNeed = requestItem.remaining_quantity ?? requestItem.requested_quantity
              const donorAvailableQuantity = requestItem.donor_available_quantity
                ?? eligibleDonations.reduce((total, donation) => total + (donation.available_quantity ?? donation.quantity), 0)
              const donorCanFulfillQuantity = requestItem.donor_can_fulfill_quantity
                ?? Math.min(donorAvailableQuantity, remainingNeed)
              const selectedDonationQuantity = selectedDonation
                ? (selectedDonation.available_quantity ?? selectedDonation.quantity)
                : donorAvailableQuantity
              const maximumContribution = Math.min(selectedDonationQuantity, remainingNeed)
              const enteredQuantity = Number(formState.quantity)
              const exceedsContributionLimit = formState.quantity !== ''
                && (!Number.isFinite(enteredQuantity) || enteredQuantity <= 0 || enteredQuantity > maximumContribution)
              const requestCategoryLabel = requestItem.category
                || requestItem.donation?.category
                || matchingDonations[0]?.category
                || 'Other'
              return (
                <article key={requestItem.id} className={`rounded-2xl border p-4 ${requestItem.priority === 'high' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{requestItem.food_name || requestItem.donation?.food_name || requestItem.purpose}</p>
                      <p className="mt-1 text-xs text-slate-500">Category: {requestCategoryLabel}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${requestPriorityClass(requestItem.priority)}`}>
                          {requestItem.priority || 'Priority not specified'}
                        </span>
                        <span className="text-xs text-slate-600">Required by: {requiredDateTimeLabel(requestItem.required_date, requestItem.required_time)}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        NGO Requested: {requestItem.requested_quantity} {requestItem.quantity_unit || ''} · Contributed: {requestItem.contributed_quantity || 0} {requestItem.quantity_unit || ''} · Remaining Need: {requestItem.remaining_quantity ?? requestItem.requested_quantity} {requestItem.quantity_unit || ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Donor Available: {donorAvailableQuantity} {requestItem.quantity_unit || ''} · Donor Can Fulfill: {donorCanFulfillQuantity} {requestItem.quantity_unit || ''} · Remaining Need: {requestItem.remaining_quantity ?? requestItem.requested_quantity} {requestItem.quantity_unit || ''}
                      </p>
                      {requestItem.out_of_stock && <p className="mt-1 text-xs font-semibold text-red-700">Out of Stock</p>}
                      <p className="mt-1 text-xs text-slate-500">
                        Receiver: {requestItem.receiver_name || 'Food receiver'}{requestItem.receiver_city ? ` · ${requestItem.receiver_city}` : ''} · Status: {formatRequestStatus(requestItem.status)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Delivery / Drop-off Location: {requestItem.delivery_location || 'Not provided'}</p>
                    </div>
                    {myContribution && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusToneClass(myContribution.delivery_status || myContribution.status)}`}>Your contribution: {myContribution.quantity} {myContribution.quantity_unit} · {formatStatus(myContribution.delivery_status || myContribution.status)}</span>}
                  </div>
                  {requestItem.multi_contribution && !myContribution && !['fulfilled', 'completed', 'rejected', 'cancelled'].includes(requestItem.status) && (requestItem.remaining_quantity ?? 0) > 0 && (
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_10rem_auto] md:items-end">
                      <label className="text-xs font-semibold text-slate-700">
                        Your food listing ({requestItem.quantity_unit})
                        <select
                          value={formState.donation_id}
                          onChange={(event) => setRequestContributionForms((current) => ({
                            ...current,
                            [requestItem.id]: { ...formState, donation_id: event.target.value },
                          }))}
                          className="input-shell mt-1"
                        >
                          <option value="">Select donation</option>
                          {matchingDonations.map((donation) => {
                            const stock = donation.available_quantity ?? donation.quantity
                            const isAvailable = ['available', 'requested', 'accepted'].includes(donation.status) && stock > 0
                            return <option key={donation.id} value={donation.id} disabled={!isAvailable}>{donation.food_name} · {stock} {donation.quantity_unit}{isAvailable ? '' : ' · Out of Stock'}</option>
                          })}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-700">
                        Contribution amount (max {maximumContribution} {requestItem.quantity_unit})
                        <input type="number" min="0.01" step="any" max={maximumContribution} value={formState.quantity} disabled={!selectedDonation} onChange={(event) => setRequestContributionForms((current) => ({
                          ...current,
                          [requestItem.id]: { ...formState, quantity: event.target.value },
                        }))} className="input-shell mt-1" required />
                      </label>
                      <button type="button" onClick={() => void contributeToRequest(requestItem)} disabled={!selectedDonation || !formState.quantity || exceedsContributionLimit || maximumContribution <= 0} className="primary-btn inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold disabled:opacity-50"><HandHeart size={14} />Contribute</button>
                      {selectedDonation && <p className="text-xs text-slate-600 md:col-span-3">Selected listing stock: {selectedDonationQuantity} {requestItem.quantity_unit}. You can contribute up to {maximumContribution} {requestItem.quantity_unit}.</p>}
                      {exceedsContributionLimit && <p className="text-xs text-red-700 md:col-span-3" role="alert">Contribution cannot exceed the remaining request or your available stock ({maximumContribution} {requestItem.quantity_unit}).</p>}
                      {!matchingDonations.length && <p className="text-xs text-amber-700 md:col-span-3">No donor listing matches this food category and quantity unit.</p>}
                      {matchingDonations.length > 0 && !eligibleDonations.length && !requestItem.out_of_stock && !requestItem.pending_delivery && requestItem.status !== 'fulfilled' && requestItem.status !== 'completed' && <p className="text-xs font-medium text-slate-600 md:col-span-3">No available matching listing in your inventory right now.</p>}
                    </div>
                  )}
                  {requestItem.contributions?.filter((item) => item.donor_id === user.id).map((item) => (
                    <p key={item.id} className="mt-2 text-xs text-slate-600">
                      {item.quantity} {item.quantity_unit} from {item.food_name || 'your donation'} · {item.delivery_status ? formatStatus(item.delivery_status) : formatStatus(item.status)}
                      {item.volunteer_name ? ` · Volunteer: ${item.volunteer_name}` : ''}
                    </p>
                  ))}
                  {!requestItem.multi_contribution && <p className="mt-3 text-xs text-slate-500">This request is tied to a specific donation listing and is managed by that listing’s donor.</p>}
                </article>
              )
            })}
          </div>
        ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No receiver food requests are accepting contributions.</p>}
        {message && <p className="mt-4 text-sm text-[#1d4d3d]" role="status">{message}</p>}
      </section>

      <section id="donations" className="section-shell rounded-[28px] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">My donations</h2>
          <span className="rounded-full bg-[#edf8ef] px-2.5 py-1 text-xs font-semibold text-[#1d4d3d]">{donations.filter((donation) => ['available', 'requested', 'accepted'].includes(donation.status)).length} active listings</span>
        </div>

        {donations.length ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 bg-white text-left text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Food</th>
                  <th className="px-4 py-3 font-semibold">Quantity</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {donations.map((donation) => (
                  <tr key={donation.id} id={`donation-feedback-${donation.id}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <DonationImage donation={donation} className="h-12 w-12 rounded-xl object-cover" />
                        <div>
                          <p className="font-semibold text-slate-800">{donation.food_name}</p>
                          <p className="text-xs text-slate-500">{donation.category}</p>
                          <p className={`mt-1 text-xs font-medium ${expiryToneClass(donation.available_until)}`}>Food expiry: {foodExpiryDateTime(donation.available_until)}</p>
                          <p className="mt-1 text-xs text-slate-600">Pickup available until: {pickupDeadlineDateTime(donation.pickup_available_until)}</p>
                          {donation.feedback?.length ? (
                            <div className="mt-2 space-y-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">
                              <p className="flex items-center gap-1 font-semibold"><HandHeart size={15} />Receiver appreciation</p>
                              {donation.feedback.map((feedback) => (
                                <div key={feedback.id} className="border-t border-emerald-100 pt-2">
                                  <p className="flex items-center gap-1 font-medium" aria-label={`Rating ${feedback.rating} out of 5`}>
                                    {Array.from({ length: 5 }, (_, index) => <Star key={index} size={14} className={index < feedback.rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'} />)}
                                    <span className="ml-1">{feedback.rating}/5 · Receiver</span>
                                    {feedback.created_at ? ` · ${new Date(feedback.created_at).toLocaleString()}` : ''}
                                  </p>
                                  <p className="mt-1 font-medium">{donation.food_name} · {donation.category} · {donation.quantity} {donation.quantity_unit}</p>
                                  <p className="mt-1"><span className="font-semibold">Food condition:</span> {feedback.food_condition_feedback || 'Not recorded'}</p>
                                  <p className="mt-1"><span className="font-semibold">Delivery experience:</span> {feedback.delivery_experience_feedback || 'Not recorded'}</p>
                                  {feedback.delivery_id && <p className="mt-1">Delivery: {feedback.delivery_id}</p>}
                                  <p className="mt-1 whitespace-pre-wrap">{feedback.appreciation_message || 'The receiver shared their appreciation for your donation.'}</p>
                                  {(feedback.comments || feedback.comment) && <p className="mt-1 whitespace-pre-wrap"><span className="font-semibold">Comments:</span> {feedback.comments || feedback.comment}</p>}
                                  <p className="mt-2 font-medium text-emerald-800">Your generosity makes another meal possible. Thank you for continuing to donate.</p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{donation.quantity} {donation.quantity_unit}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusToneClass(donation.status)}`}>{formatStatus(donation.status)}</span>
                      {donation.status === 'cancelled' && (
                        <div className="mt-1 text-xs text-slate-600">
                          <p>Reason: {donation.cancellation_reason || 'Not recorded'}</p>
                          {donation.cancelled_at && <p>Cancelled: {new Date(donation.cancelled_at).toLocaleString()}</p>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{donation.pickup_location}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => fillFormForEdit(donation)} className="primary-btn inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold"><Pencil size={13} />Edit</button>
                        {donation.cancellation_eligible && <button type="button" onClick={() => { setCancellingDonationId(donation.id); setCancellationReason(''); setCancellationDetails('') }} className="secondary-btn inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold"><X size={13} />Cancel donation</button>}
                        <button type="button" onClick={() => setDeletingDonationId(donation.id)} className="secondary-btn inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-red-700"><Trash2 size={13} />Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No donations yet. Create your first listing to get started.</div>
        )}
      </section>

      <section id="requests" className="section-shell rounded-[28px] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Donation requests</h2>
          <span className="rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#1d4ed8]">{supplierRequests.filter((request) => !['completed', 'fulfilled', 'rejected', 'cancelled'].includes(request.status)).length} active requests</span>
        </div>

        {supplierRequests.length ? (
          <div className="space-y-3">
            {supplierRequests.map((request) => {
              const donation = donations.find((item) => item.id === request.donation_id)
              return (
                <div key={request.id} className={`rounded-2xl border p-4 ${request.priority === 'high' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-lg font-bold text-slate-900">{donation?.food_name || 'Food listing'}</p>
                      <p className="text-sm text-slate-600">Requested: {request.requested_quantity} {request.quantity_unit || ''} · Remaining: {request.remaining_to_deliver_quantity ?? request.requested_quantity} {request.quantity_unit || ''}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${requestPriorityClass(request.priority)}`}>{request.priority || 'Priority not specified'}</span>
                        <span className="text-xs text-slate-600">Required by: {requiredDateTimeLabel(request.required_date, request.required_time)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Receiver: {request.receiver_name || 'Food receiver'}{request.receiver_city ? ` · ${request.receiver_city}` : ''}</p>
                      <p className="text-xs text-slate-500">Status: {formatStatus(request.status)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => updateRequestStatus(request.id, 'approved')} className="primary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold disabled:opacity-50" disabled={request.status !== 'pending'}><CheckCircle2 size={13} />Approve</button>
                      <button type="button" onClick={() => updateRequestStatus(request.id, 'rejected')} className="secondary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold disabled:opacity-50" disabled={request.status !== 'pending'}><X size={13} />Reject</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No food requests have come through yet.</div>
        )}
      </section>

      <section className="section-shell rounded-[28px] p-5">
        <h2 className="text-2xl font-bold text-slate-900">Community needs</h2>
        {needs.length ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {needs.map((need) => (
              <div key={need.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold text-slate-900">{need.category}</p>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusToneClass(need.status)}`}>{formatStatus(need.status)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{need.location} • {need.required_quantity} required</p>
                <label className="mt-3 block text-xs font-semibold text-slate-700">
                  Food pickup location
                  <input
                    value={needPickupLocations[need.id] ?? need.pickup_location ?? (user.address ? `${user.address}${user.city ? `, ${user.city}` : ''}` : user.city || '')}
                    onChange={(event) => setNeedPickupLocations((current) => ({ ...current, [need.id]: event.target.value }))}
                    className="input-shell mt-1"
                    placeholder="Street address, city"
                    required
                    disabled={need.pickup_location_locked}
                  />
                </label>
                {need.has_responded && need.pickup_location_locked ? (
                  <p className="mt-3 text-xs font-semibold text-[#1d4d3d]">Delivery assigned · pickup location is locked</p>
                ) : (
                  <button type="button" onClick={() => void respondToNeed(need)} disabled={!(needPickupLocations[need.id] ?? need.pickup_location ?? (user.address ? `${user.address}${user.city ? `, ${user.city}` : ''}` : user.city || '')).trim()} className="primary-btn mt-3 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">
                    {need.has_responded ? 'Save pickup location' : 'Respond'}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No active community needs.</div>
        )}
      </section>
      {cancellingDonationId && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" role="presentation">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_64px_rgba(15,23,42,0.24)]" role="dialog" aria-modal="true" aria-labelledby="cancel-donation-title">
            <h2 id="cancel-donation-title" className="text-lg font-bold text-slate-900">Cancel donation</h2>
            <p className="mt-3 text-sm text-slate-600">This will stop new requests and close any active delivery assignment. Existing delivery history will be retained.</p>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Cancellation reason
              <select value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} className="input-shell mt-1" required>
                <option value="">Select a reason</option>
                <option value="Food is no longer safe to donate">Food is no longer safe to donate</option>
                <option value="Pickup arrangements changed">Pickup arrangements changed</option>
                <option value="Donation details were incorrect">Donation details were incorrect</option>
                <option value="Other">Other</option>
              </select>
            </label>
            {cancellationReason === 'Other' && (
              <label className="mt-3 block text-sm font-semibold text-slate-700">
                Please specify
                <textarea value={cancellationDetails} onChange={(event) => setCancellationDetails(event.target.value)} className="input-shell mt-1 min-h-20" maxLength={1000} required />
              </label>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCancellingDonationId(null)} className="secondary-btn px-4 py-2 text-sm font-semibold" disabled={cancellingDonation}>Go Back</button>
              <button type="button" onClick={() => void cancelDonation()} className="rounded-full bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={cancellingDonation || !cancellationReason || (cancellationReason === 'Other' && !cancellationDetails.trim())}>
                {cancellingDonation ? 'Cancelling…' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deletingDonationId && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" role="presentation">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_64px_rgba(15,23,42,0.24)]" role="dialog" aria-modal="true" aria-labelledby="delete-donation-title">
            <h2 id="delete-donation-title" className="text-lg font-bold text-slate-900">Delete donation</h2>
            <p className="mt-3 text-sm text-slate-600">Are you sure you want to delete this donation?</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeletingDonationId(null)} className="secondary-btn px-4 py-2 text-sm font-semibold" disabled={deletingDonation}>Cancel</button>
              <button type="button" onClick={deleteDonation} className="rounded-full bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={deletingDonation}>
                {deletingDonation ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedCertificate && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 sm:p-6" role="presentation">
          <style>{`
            @keyframes certificate-pop { from { opacity: 0; transform: translateY(18px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
            .certificate-modal-card { animation: certificate-pop .42s cubic-bezier(.2,.8,.2,1) both; }
            @media (prefers-reduced-motion: reduce) { .certificate-modal-card { animation: none !important; } }
          `}</style>
          <div className="relative my-auto w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl certificate-modal-card" role="dialog" aria-modal="true" aria-labelledby="certificate-modal-title">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4df] text-[#b45309]">
                  <Trophy size={24} />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#1d4d3d]">{selectedCertificate.certificate_id}</p>
                  <h2 id="certificate-modal-title" className="text-lg font-bold text-slate-900 sm:text-xl">
                    {isDonorCertificate(selectedCertificate) ? 'Certificate of Appreciation' : selectedCertificate.title}
                  </h2>
                </div>
              </div>
              <button type="button" onClick={closeCertificate} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close certificate">
                <X size={20} />
              </button>
            </div>
            <div className="max-h-[68vh] overflow-auto bg-[#eeece5] p-3 sm:p-5">
              {isDonorCertificate(selectedCertificate) ? (
                <iframe
                  title={`Certificate of Appreciation for ${selectedCertificate.donor_name}`}
                  srcDoc={createDonationCertificateHtml(
                    selectedCertificate,
                    donationCertificates.find((item) => item.donation_id === selectedCertificate.donation_id),
                  )}
                  className="mx-auto block border-0 shadow-lg"
                  style={{ width: 'min(100%, calc(68vh * 1.4142))', aspectRatio: '297 / 210' }}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 p-4 sm:p-5">
              <button type="button" onClick={() => void downloadCertificatePdf(selectedCertificate)} disabled={downloadingCertificateId === selectedCertificate.id} className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">
                <Download size={16} />{downloadingCertificateId === selectedCertificate.id ? 'Preparing PDF…' : 'Download Certificate'}
              </button>
              <button type="button" onClick={() => printCertificate(selectedCertificate)} className="secondary-btn px-4 py-2 text-sm font-semibold">Print / Save PDF</button>
              <button type="button" onClick={closeCertificate} className="secondary-btn px-4 py-2 text-sm font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NgoDashboard({
  user,
  overview,
  donations,
  requests,
  deliveryTasks,
  donationCancellations,
  needs,
  onReload,
  onUserUpdate,
}: {
  user: SessionUser
  overview: DashboardSummary | null
  donations: Donation[]
  requests: RequestItem[]
  deliveryTasks: DeliveryTask[]
  donationCancellations: DonationCancellation[]
  needs: CommunityNeed[]
  onReload: () => Promise<void>
  onUserUpdate: (user: SessionUser) => void
}) {
  const [message, setMessage] = useState('')
  const [acceptingTaskId, setAcceptingTaskId] = useState<string | null>(null)
  const [issueStatusDrafts, setIssueStatusDrafts] = useState<Record<string, DeliveryIssue['status']>>({})
  const [issueActionDrafts, setIssueActionDrafts] = useState<Record<string, '' | 'yes' | 'no'>>({})
  const [issueActionNoteDrafts, setIssueActionNoteDrafts] = useState<Record<string, string>>({})
  const [feedbackDeliveryTaskId, setFeedbackDeliveryTaskId] = useState<string | null>(null)
  const [feedbackDialogMode, setFeedbackDialogMode] = useState<'feedback' | 'issue'>('feedback')
  const [requestQuantities, setRequestQuantities] = useState<Record<string, string>>({})
  const [requestDeliveryLocations, setRequestDeliveryLocations] = useState<Record<string, string>>({})
  const [requestSchedules, setRequestSchedules] = useState<Record<string, {
    priority: 'high' | 'medium' | 'low'
    required_date: string
    required_time: string
  }>>({})
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({})
  const [submittingRequestIds, setSubmittingRequestIds] = useState<Set<string>>(() => new Set())
  const [requestFeedback, setRequestFeedback] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({})
  const submittingRequestIdsRef = useRef(new Set<string>())
  const [foodRequestForm, setFoodRequestForm] = useState({
    food_name: '',
    category: 'Meals',
    requested_quantity: '',
    quantity_unit: 'servings',
    delivery_location: [user.address, user.city].filter(Boolean).join(', '),
    purpose: '',
    priority: 'medium' as 'high' | 'medium' | 'low',
    required_date: '',
    required_time: '',
  })
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([])
  const [availabilityLoading, setAvailabilityLoading] = useState(true)
  const [availabilityError, setAvailabilityError] = useState('')
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [availableVolunteers, setAvailableVolunteers] = useState<AvailableVolunteer[]>([])
  const [needVolunteerSelections, setNeedVolunteerSelections] = useState<Record<string, string>>({})
  const [availabilityForm, setAvailabilityForm] = useState({ date: localDateInputValue(), status: 'available' as AvailabilityEntry['status'], notes: '' })
  const [editingAvailabilityId, setEditingAvailabilityId] = useState<string | null>(null)
  const [availabilityMonth, setAvailabilityMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState(localDateInputValue())
  const [availabilityNameFilter, setAvailabilityNameFilter] = useState('')
  const [availabilityDateFilter, setAvailabilityDateFilter] = useState('')
  const [availabilityStatusFilter, setAvailabilityStatusFilter] = useState<'all' | AvailabilityEntry['status']>('all')
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [routeForm, setRouteForm] = useState({ pickup_location: '', dropoff_location: '' })
  const [savingAvailability, setSavingAvailability] = useState(false)
  const [certificateIssueDate, setCertificateIssueDate] = useState<string | null>(null)
  const [certificateDeliveryCount, setCertificateDeliveryCount] = useState<number | null>(null)
  const [volunteerCertificateHtml, setVolunteerCertificateHtml] = useState('')
  const [volunteerCertificateId, setVolunteerCertificateId] = useState('')
  const [certificatePreviewOpen, setCertificatePreviewOpen] = useState(false)
  const [certificateGenerating, setCertificateGenerating] = useState(false)
  const [certificateDownloading, setCertificateDownloading] = useState(false)
  const [certificateError, setCertificateError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    full_name: user.full_name,
    organization_name: user.organization_name || '',
    phone: user.phone || '',
    address: user.address || '',
    city: user.city || '',
  })
  const [taskForm, setTaskForm] = useState({ request_id: '', dropoff_location: '', dropoff_instructions: '' })
  const [needFormOpen, setNeedFormOpen] = useState(true)
  const [editingNeedId, setEditingNeedId] = useState<string | null>(null)
  const [deletingNeedId, setDeletingNeedId] = useState<string | null>(null)
  const [needFoodName, setNeedFoodName] = useState('')
  const [needForm, setNeedForm] = useState({
    category: 'Meals',
    required_quantity: '25',
    location: '',
    city: 'Coimbatore',
    urgency: 'high',
    required_date: '',
    description: '',
  })

  const fetchAvailability = useCallback(() => apiRequest('/volunteer/availability'), [])
  const handleRefreshAvailability = () => {
    setAvailabilityLoading(true)
    setAvailabilityError('')
    fetchAvailability()
      .then((response) => setAvailability(response.availability || []))
      .catch((error) => setAvailabilityError(error instanceof Error ? error.message : 'Unable to load volunteer availability'))
      .finally(() => setAvailabilityLoading(false))
  }

  useEffect(() => {
    if (user.role === 'volunteer') {
      fetchAvailability()
        .then((response) => setAvailability(response.availability || []))
        .catch((error) => setAvailabilityError(error instanceof Error ? error.message : 'Unable to load volunteer availability'))
        .finally(() => setAvailabilityLoading(false))
      apiRequest('/volunteer/leaderboard')
        .then((response) => setLeaderboard(response.leaderboard || []))
        .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load volunteer leaderboard'))
    } else if (user.role === 'ngo') {
      fetchAvailability()
        .then((response) => setAvailability(response.availability || []))
        .catch((error) => setAvailabilityError(error instanceof Error ? error.message : 'Unable to load volunteer availability'))
        .finally(() => setAvailabilityLoading(false))
      apiRequest('/community-needs/available-volunteers')
        .then((response) => setAvailableVolunteers(uniqueAvailableVolunteers(response.volunteers || [])))
        .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load available volunteers'))
    }
  }, [fetchAvailability, user.id, user.role])

  const saveAvailability = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingAvailability(true)
    try {
      const response = await apiRequest(
        editingAvailabilityId ? `/volunteer/availability/${editingAvailabilityId}` : '/volunteer/availability',
        {
          method: editingAvailabilityId ? 'PATCH' : 'POST',
          body: JSON.stringify(availabilityForm),
        },
      )
      setAvailability((current) => {
        const next = current.filter((entry) => (
          entry.id !== response.availability.id
          && entry.date !== response.availability.date
        ))
        next.push(response.availability)
        return next.sort((left, right) => left.date.localeCompare(right.date))
      })
      setEditingAvailabilityId(null)
      setAvailabilityForm({ date: localDateInputValue(), status: 'available', notes: '' })
      setMessage('Availability saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save availability')
    } finally {
      setSavingAvailability(false)
    }
  }

  const editAvailability = (entry: AvailabilityEntry) => {
    setEditingAvailabilityId(entry.id)
    setAvailabilityForm({ date: entry.date, status: entry.status, notes: entry.notes || '' })
  }

  const deleteAvailability = async (entry: AvailabilityEntry) => {
    if (!window.confirm(`Delete availability for ${entry.date}?`)) return
    try {
      await apiRequest(`/volunteer/availability/${entry.id}`, { method: 'DELETE' })
      setAvailability((current) => current.filter((item) => item.id !== entry.id))
      if (editingAvailabilityId === entry.id) {
        setEditingAvailabilityId(null)
        setAvailabilityForm({ date: localDateInputValue(), status: 'available', notes: '' })
      }
      setMessage('Availability entry deleted.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete availability')
    }
  }

  const saveRoute = async (event: React.FormEvent<HTMLFormElement>, taskId: string) => {
    event.preventDefault()
    try {
      await apiRequest(`/delivery-tasks/${taskId}/route`, {
        method: 'PATCH',
        body: JSON.stringify(routeForm),
      })
      await onReload()
      setEditingRouteId(null)
      setMessage('Delivery addresses updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update delivery addresses')
    }
  }

  const startRouteEdit = (task: DeliveryTask) => {
    setEditingRouteId(task.id)
    setRouteForm({
      pickup_location: task.pickup_location,
      dropoff_location: task.dropoff_location,
    })
  }

  const cancelRouteEdit = () => {
    setEditingRouteId(null)
    setRouteForm({ pickup_location: '', dropoff_location: '' })
  }

  const generateCertificate = async (completedCount: number) => {
    setCertificateGenerating(true)
    setCertificateError('')
    const issueDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())
    try {
      const certificateId = createUniqueCertificateId('VOL')
      const certificate = createVolunteerCertificateHtml(user.full_name, completedCount, issueDate, certificateId)
      setCertificateIssueDate(issueDate)
      setCertificateDeliveryCount(completedCount)
      setVolunteerCertificateId(certificateId)
      setVolunteerCertificateHtml(certificate)
      setCertificatePreviewOpen(true)
    } catch (error) {
      setCertificateError(error instanceof Error ? error.message : 'Unable to generate the volunteer certificate.')
    } finally {
      setCertificateGenerating(false)
    }
  }

  const downloadVolunteerCertificate = async () => {
    if (
      !volunteerCertificateHtml
      || !volunteerCertificateId
      || certificateIssueDate === null
      || certificateDeliveryCount === null
    ) return
    setCertificateDownloading(true)
    setCertificateError('')
    try {
      await requestVolunteerCertificateDownload({
        certificate_id: volunteerCertificateId,
        recipient_name: user.full_name,
        completed_deliveries: certificateDeliveryCount,
        issue_date: certificateIssueDate,
      })
    } catch (error) {
      setCertificateError(error instanceof Error ? error.message : 'Unable to download the volunteer certificate PDF.')
    } finally {
      setCertificateDownloading(false)
    }
  }

  const handleRequestDonation = async (donation: Donation) => {
    if (submittingRequestIdsRef.current.has(donation.id)) return
    const deliveryLocation = (requestDeliveryLocations[donation.id] || '').trim()
    const schedule = requestSchedules[donation.id] || { priority: 'medium' as const, required_date: '', required_time: '' }
    if (!deliveryLocation) {
      setRequestFeedback((current) => ({
        ...current,
        [donation.id]: { type: 'error', text: 'Enter a delivery / drop-off location before requesting food.' },
      }))
      return
    }
    if (!schedule.required_date || !schedule.required_time) {
      setRequestFeedback((current) => ({
        ...current,
        [donation.id]: { type: 'error', text: 'Enter the required date and time before requesting food.' },
      }))
      return
    }
    const requiredAt = new Date(`${schedule.required_date}T${schedule.required_time}`)
    if (Number.isNaN(requiredAt.getTime()) || requiredAt.getTime() <= Date.now()) {
      setRequestFeedback((current) => ({
        ...current,
        [donation.id]: { type: 'error', text: 'The required date and time must be in the future.' },
      }))
      return
    }
    submittingRequestIdsRef.current.add(donation.id)
    setSubmittingRequestIds((current) => new Set(current).add(donation.id))
    setRequestFeedback((current) => {
      const next = { ...current }
      delete next[donation.id]
      return next
    })
    const availableQuantity = donation.available_quantity ?? donation.quantity
    const requestedQuantity = Number(requestQuantities[donation.id] ?? availableQuantity)
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      setRequestFeedback((current) => ({
        ...current,
        [donation.id]: { type: 'error', text: 'Enter a requested quantity greater than zero.' },
      }))
      submittingRequestIdsRef.current.delete(donation.id)
      setSubmittingRequestIds((current) => {
        const next = new Set(current)
        next.delete(donation.id)
        return next
      })
      return
    }
    if (requestedQuantity > availableQuantity) {
      const unit = quantityUnitLabel(availableQuantity, donation.quantity_unit)
      const error = `Only ${availableQuantity} ${unit} ${availableQuantity === 1 ? 'is' : 'are'} currently available. Please reduce your requested quantity.`
      setRequestErrors((current) => ({ ...current, [donation.id]: error }))
      setRequestFeedback((current) => ({ ...current, [donation.id]: { type: 'error', text: error } }))
      submittingRequestIdsRef.current.delete(donation.id)
      setSubmittingRequestIds((current) => {
        const next = new Set(current)
        next.delete(donation.id)
        return next
      })
      return
    }
    try {
      await apiRequest('/donation-requests', {
        method: 'POST',
        body: JSON.stringify({
          donation_id: donation.id,
          requested_quantity: requestedQuantity,
          quantity_unit: donation.quantity_unit,
          food_name: donation.food_name,
          delivery_location: deliveryLocation,
          priority: schedule.priority,
          required_date: schedule.required_date,
          required_time: schedule.required_time,
          purpose: `Community support request for ${donation.food_name}`,
        }),
      })
      setRequestErrors((current) => ({ ...current, [donation.id]: '' }))
      setRequestQuantities((current) => ({
        ...current,
        [donation.id]: String(Math.max(0, availableQuantity - requestedQuantity)),
      }))
      setRequestFeedback((current) => ({
        ...current,
        [donation.id]: { type: 'success', text: 'Food request submitted successfully and added to My Request History.' },
      }))
      await onReload()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to request food'
      setRequestFeedback((current) => ({
        ...current,
        [donation.id]: { type: 'error', text: errorMessage },
      }))
      if (errorMessage.includes('currently available')) {
        setRequestErrors((current) => ({ ...current, [donation.id]: errorMessage }))
      }
      await onReload()
    } finally {
      submittingRequestIdsRef.current.delete(donation.id)
      setSubmittingRequestIds((current) => {
        const next = new Set(current)
        next.delete(donation.id)
        return next
      })
    }
  }

  const handleCreateFoodRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    const requiredAt = new Date(`${foodRequestForm.required_date}T${foodRequestForm.required_time}`)
    if (!foodRequestForm.required_date || !foodRequestForm.required_time || Number.isNaN(requiredAt.getTime())) {
      setMessage('Please enter both the required date and required time.')
      return
    }
    if (requiredAt.getTime() <= Date.now()) {
      setMessage('The required date and time must be in the future.')
      return
    }
    try {
      await apiRequest('/donation-requests', {
        method: 'POST',
        body: JSON.stringify({
          ...foodRequestForm,
          food_name: foodRequestForm.food_name.trim(),
          category: foodRequestForm.category,
          requested_quantity: Number(foodRequestForm.requested_quantity),
        }),
      })
      setMessage('Food request posted for donor contributions.')
      setFoodRequestForm({
        food_name: '',
        category: 'Meals',
        requested_quantity: '',
        quantity_unit: 'servings',
        delivery_location: [user.address, user.city].filter(Boolean).join(', '),
        purpose: '',
        priority: 'medium',
        required_date: '',
        required_time: '',
      })
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create food request')
    }
  }

  const handleCreateNeed = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const response = await apiRequest(
        editingNeedId ? `/community-needs/${encodeURIComponent(editingNeedId)}` : '/community-needs',
        {
        method: editingNeedId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...needForm,
          required_quantity: Number(needForm.required_quantity),
          description: `${needFoodName.trim()}\n\n${needForm.description.trim()}`,
        }),
      })
      if (editingNeedId && response.need?.id !== editingNeedId) {
        throw new Error('The server did not confirm that the existing community need was updated.')
      }
      setMessage(editingNeedId ? 'Community need updated successfully.' : 'Community need created successfully.')
      setEditingNeedId(null)
      setNeedFoodName('')
      setNeedForm({
        category: 'Meals',
        required_quantity: '25',
        location: '',
        city: 'Coimbatore',
        urgency: 'high',
        required_date: '',
        description: '',
      })
      setNeedFormOpen(false)
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create need')
    }
  }

  const cancelCreateNeed = () => {
    setEditingNeedId(null)
    setNeedFoodName('')
    setNeedForm({
      category: 'Meals',
      required_quantity: '25',
      location: '',
      city: 'Coimbatore',
      urgency: 'high',
      required_date: '',
      description: '',
    })
    setNeedFormOpen(false)
  }

  const editCommunityNeed = (need: CommunityNeed) => {
    const [savedFoodName, ...savedDescription] = need.description.split(/\r?\n\r?\n/, 2)
    const hasSavedFoodName = savedDescription.length > 0
    setEditingNeedId(need.id)
    setNeedFoodName(hasSavedFoodName ? savedFoodName : '')
    setNeedForm({
      category: need.category,
      required_quantity: String(need.required_quantity),
      location: need.location,
      city: need.city,
      urgency: need.urgency,
      required_date: dateTimeInputValue(need.required_date),
      description: hasSavedFoodName ? savedDescription[0] : need.description,
    })
    setMessage('')
    setNeedFormOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById('community-need-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const deleteCommunityNeed = async (need: CommunityNeed) => {
    if (!window.confirm('Delete this community need and all responses and delivery records linked to it? This cannot be undone.')) return
    setDeletingNeedId(need.id)
    setMessage('')
    try {
      await apiRequest(`/community-needs/${encodeURIComponent(need.id)}`, { method: 'DELETE' })
      setMessage('Community need and its linked records deleted.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete community need')
    } finally {
      setDeletingNeedId(null)
    }
  }

  const cancelRequest = async (requestId: string) => {
    if (!window.confirm('Cancel this food request? Its reserved quantity will become available again.')) return
    try {
      await apiRequest(`/donation-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      })
      setMessage('Food request cancelled and its reserved quantity released.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to cancel request')
    }
  }

  const deleteRequest = async (requestId: string) => {
    if (!window.confirm('Delete this food request? Requests with donor contributions, accepted donations, or delivery history cannot be deleted.')) return
    try {
      await apiRequest(`/donation-requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' })
      setMessage('Food request deleted.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete request')
    }
  }

  const updateRequestStatus = async (requestId: string, status: 'approved' | 'rejected') => {
    try {
      await apiRequest(`/donation-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setMessage(`Food request ${status}.`)
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update food request')
    }
  }

  const coordinateDonationCancellation = async (cancellation: DonationCancellation) => {
    try {
      await apiRequest(`/donation-cancellations/${encodeURIComponent(cancellation.id)}/coordinate`, { method: 'POST' })
      setMessage('Alternative arrangements are now coordinated through the existing food request.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to coordinate alternative arrangements')
    }
  }

  const updateDeliveryIssueStatus = async (issue: DeliveryIssue) => {
    const status = issueStatusDrafts[issue.id] || issue.status
    try {
      await apiRequest(`/delivery-issues/${encodeURIComponent(issue.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setMessage('Delivery issue status updated.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update delivery issue')
    }
  }

  const saveDeliveryIssueAction = async (issue: DeliveryIssue) => {
    const actionTaken = issueActionDrafts[issue.id]
      || (issue.action_taken === true ? 'yes' : issue.action_taken === false ? 'no' : '')
    const actionNote = issueActionNoteDrafts[issue.id] ?? issue.resolution_note ?? ''
    if (!actionTaken) {
      setMessage('Select Yes or No for whether action was taken.')
      return
    }
    try {
      await apiRequest(`/delivery-issues/${encodeURIComponent(issue.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: actionTaken === 'yes' ? 'resolved' : 'under_review',
          action_taken: actionTaken === 'yes',
          resolution_note: actionTaken === 'yes' ? actionNote.trim() : '',
        }),
      })
      setIssueActionDrafts((current) => ({ ...current, [issue.id]: '' }))
      setIssueActionNoteDrafts((current) => ({ ...current, [issue.id]: '' }))
      setMessage('Issue action saved.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save issue action')
    }
  }

  const createDeliveryTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      await apiRequest('/delivery-tasks', {
        method: 'POST',
        body: JSON.stringify(taskForm),
      })
      setMessage('Delivery task added to the volunteer queue.')
      setTaskForm({ request_id: '', dropoff_location: '', dropoff_instructions: '' })
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create delivery task')
    }
  }

  const assignNeedDelivery = async (need: CommunityNeed, contribution: CommunityNeedContribution) => {
    const volunteerId = needVolunteerSelections[contribution.id]
    if (!volunteerId) {
      setMessage('Select an available volunteer for this donor response.')
      return
    }
    try {
      await apiRequest(`/community-needs/${need.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ contribution_id: contribution.id, volunteer_id: volunteerId }),
      })
      setMessage('Delivery assigned; it is now in the volunteer’s delivery dashboard.')
      setNeedVolunteerSelections((current) => ({ ...current, [contribution.id]: '' }))
      const [volunteerResponse] = await Promise.all([
        apiRequest('/community-needs/available-volunteers'),
        onReload(),
      ])
      setAvailableVolunteers(uniqueAvailableVolunteers(volunteerResponse.volunteers || []))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to assign community need delivery')
    }
  }

  const assignRequestContribution = async (requestItem: RequestItem, contribution: RequestContribution) => {
    const volunteerId = needVolunteerSelections[contribution.id]
    if (!volunteerId) {
      setMessage('Select an available volunteer for this donor contribution.')
      return
    }
    try {
      await apiRequest(`/donation-requests/${requestItem.id}/contributions/${contribution.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ volunteer_id: volunteerId }),
      })
      setMessage('Contribution delivery assigned to the volunteer.')
      setNeedVolunteerSelections((current) => ({ ...current, [contribution.id]: '' }))
      const [volunteerResponse] = await Promise.all([
        apiRequest('/community-needs/available-volunteers'),
        onReload(),
      ])
      setAvailableVolunteers(uniqueAvailableVolunteers(volunteerResponse.volunteers || []))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to assign contribution delivery')
    }
  }

  const saveOrganizationProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingProfile(true)
    setProfileMessage('')
    try {
      const response = await apiRequest('/profile', {
        method: 'PATCH',
        body: JSON.stringify(profileForm),
      })
      onUserUpdate(response.user)
      setProfileMessage('Organization profile saved.')
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Unable to save organization profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const acceptDeliveryTask = async (taskId: string) => {
    setAcceptingTaskId(taskId)
    setMessage('')
    try {
      await apiRequest(`/delivery-tasks/${encodeURIComponent(taskId)}/accept`, { method: 'POST' })
      setMessage('Delivery task assigned and added to your active deliveries.')
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to accept delivery task')
    } finally {
      setAcceptingTaskId(null)
    }
  }

  const advanceDeliveryTask = async (task: DeliveryTask) => {
    const transitions: Partial<Record<DeliveryTask['status'], DeliveryTask['status']>> = {
      accepted: 'picked_up',
      picked_up: 'in_transit',
      in_transit: 'delivered',
    }
    const nextStatus = transitions[task.status]
    if (!nextStatus) return
    try {
      await apiRequest(`/delivery-tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      await onReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update delivery status')
    }
  }

  const requesterStats = [
    { label: 'Total requested', value: overview?.stats.requested_quantity ?? 0, accent: 'bg-[#edf8ef] text-[#1d4d3d]' },
    { label: 'Quantity delivered', value: overview?.stats.fulfilled_quantity ?? 0, accent: 'bg-[#fff4df] text-[#b45309]' },
    { label: 'Quantity remaining', value: overview?.stats.remaining_quantity ?? 0, accent: 'bg-[#ecfeff] text-[#0f766e]' },
    { label: 'My requests', value: overview?.stats.submitted_requests ?? 0, accent: 'bg-[#fdf2f8] text-[#be185d]' },
  ]
  const volunteerStats = [
    { label: 'Available tasks', value: overview?.stats.available_tasks ?? 0, accent: 'bg-[#edf8ef] text-[#1d4d3d]' },
    { label: 'Active deliveries', value: overview?.stats.active_deliveries ?? 0, accent: 'bg-[#fff4df] text-[#b45309]' },
    { label: 'Completed deliveries', value: overview?.stats.completed_deliveries ?? 0, accent: 'bg-[#ecfeff] text-[#0f766e]' },
  ]
  const ngoStats = [
    { label: 'Available donations', value: donations.length, accent: 'bg-[#edf8ef] text-[#1d4d3d]' },
    { label: 'Pending requests', value: overview?.stats.pending_requests ?? 0, accent: 'bg-[#fff4df] text-[#b45309]' },
    { label: 'Active deliveries', value: overview?.stats.active_deliveries ?? 0, accent: 'bg-[#ecfeff] text-[#0f766e]' },
    { label: 'Completed distributions', value: overview?.stats.completed_distributions ?? 0, accent: 'bg-[#fdf2f8] text-[#be185d]' },
  ]
  const filteredAvailability = availability.filter((entry) => {
    const volunteerName = entry.volunteer_name || ''
    return volunteerName.toLocaleLowerCase().includes(availabilityNameFilter.trim().toLocaleLowerCase())
      && (!availabilityDateFilter || entry.date === availabilityDateFilter)
      && (availabilityStatusFilter === 'all' || entry.status === availabilityStatusFilter)
  })
  const ngoMonthStart = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth(), 1)
  const ngoMonthDays = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() + 1, 0).getDate()
  const ngoCalendarCells: Array<number | null> = [
    ...Array.from({ length: ngoMonthStart.getDay() }, () => null),
    ...Array.from({ length: ngoMonthDays }, (_, index) => index + 1),
  ]
  const selectedDateAvailability = filteredAvailability.filter((entry) => entry.date === selectedAvailabilityDate)
  const requestHasExpiredDonation = (request: RequestItem) => Boolean(
    request.donation_id && isFoodExpired(request.donation?.available_until),
  )
  const isHistoricalRequest = (request: RequestItem) => (
    ['fulfilled', 'completed', 'cancelled', 'rejected'].includes(request.status)
  )
  const requestHistoryItems = requests.filter((request) => (
    isHistoricalRequest(request) || !requestHasExpiredDonation(request)
  ))
  const coordinationRequests = requests
    .filter((request) => !requestHasExpiredDonation(request))
    .map((request) => ({
      ...request,
      contributions: request.contributions?.filter((contribution) => (
        !isFoodExpired(contribution.available_until)
        || ['delivered', 'cancelled', 'rejected'].includes(contribution.status)
        || contribution.delivery_status === 'delivered'
      )),
    }))

  if (user.role === 'requester') {
    return (
      <div id="overview" className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {requesterStats.map(({ label, value, accent }) => (
            <div key={label} className="metric-card section-shell rounded-[28px] p-5">
              <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}><Package size={18} /></div>
              <p className="text-3xl font-black text-slate-900">{value}</p>
              <p className="mt-2 text-sm text-slate-600">{label}</p>
            </div>
          ))}
        </section>

        <section className="section-shell rounded-[28px] p-5">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardList size={21} className="text-[#1d4d3d]" />Request food from multiple donors</h2>
          <p className="mt-1 text-sm text-slate-600">Specify the amount and delivery location. Donors can contribute matching quantities, and the request is fulfilled only after delivery.</p>
          <form onSubmit={handleCreateFoodRequest} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center gap-1.5"><Utensils size={14} />Food needed</span>
              <input value={foodRequestForm.food_name} onChange={(event) => setFoodRequestForm((current) => ({ ...current, food_name: event.target.value }))} className="input-shell mt-1" placeholder="Cooked meals" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center gap-1.5"><Package size={14} />Category</span>
              <select value={foodRequestForm.category} onChange={(event) => setFoodRequestForm((current) => ({ ...current, category: event.target.value }))} className="input-shell mt-1">
                <option>Meals</option>
                <option>Snacks</option>
                <option>Fruits</option>
                <option>Bakery</option>
                <option>Vegetables</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center gap-1.5"><Package size={14} />Requested quantity</span>
              <input type="number" min="0.01" step="any" value={foodRequestForm.requested_quantity} onChange={(event) => setFoodRequestForm((current) => ({ ...current, requested_quantity: event.target.value }))} className="input-shell mt-1" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Unit
              <select value={foodRequestForm.quantity_unit} onChange={(event) => setFoodRequestForm((current) => ({ ...current, quantity_unit: event.target.value }))} className="input-shell mt-1">
                <option value="servings">Meals / servings</option>
                <option value="packets">Packets</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="boxes">Boxes</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center gap-1.5"><MapPin size={14} />Delivery / Drop-off Location</span>
              <input value={foodRequestForm.delivery_location} onChange={(event) => setFoodRequestForm((current) => ({ ...current, delivery_location: event.target.value }))} className="input-shell mt-1" placeholder="Full address and city" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Request Priority
              <select value={foodRequestForm.priority} onChange={(event) => setFoodRequestForm((current) => ({ ...current, priority: event.target.value as 'high' | 'medium' | 'low' }))} className="input-shell mt-1">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center gap-1.5"><CalendarDays size={14} />Required Date</span>
              <input type="date" min={localDateInputValue()} value={foodRequestForm.required_date} onChange={(event) => setFoodRequestForm((current) => ({ ...current, required_date: event.target.value }))} className="input-shell mt-1" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center gap-1.5"><Clock3 size={14} />Required Time</span>
              <input type="time" value={foodRequestForm.required_time} onChange={(event) => setFoodRequestForm((current) => ({ ...current, required_time: event.target.value }))} className="input-shell mt-1" required />
            </label>
            <label className="text-sm font-medium text-slate-700 md:col-span-2">
              Purpose / instructions
              <textarea value={foodRequestForm.purpose} onChange={(event) => setFoodRequestForm((current) => ({ ...current, purpose: event.target.value }))} className="input-shell mt-1 min-h-[72px]" placeholder="Who needs this food and any delivery details" required />
            </label>
            {message && <p className="md:col-span-2 text-sm text-[#1d4d3d]" role="status">{message}</p>}
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><Send size={15} />Post food request</button>
            </div>
          </form>
        </section>

        <section id="marketplace" className="section-shell rounded-[28px] p-5">
          <h2 className="text-2xl font-bold text-slate-900">Available food</h2>
          <p className="mt-1 text-sm text-slate-600">Browse current donations and request food for your needs.</p>
          {donations.length ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {donations.map((donation) => (
                <article key={donation.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                  <DonationImage donation={donation} className="h-48 w-full object-cover" />
                  <div className="p-4">
                    {(() => {
                      const availableQuantity = donation.available_quantity ?? donation.quantity
                      const requestedValue = requestQuantities[donation.id] ?? String(availableQuantity)
                      const requestedQuantity = Number(requestedValue)
                      const exceedsAvailability = Number.isFinite(requestedQuantity) && requestedQuantity > availableQuantity
                      const availableUnit = quantityUnitLabel(availableQuantity, donation.quantity_unit)
                      const isSubmittingRequest = submittingRequestIds.has(donation.id)
                      const requestError = requestErrors[donation.id] || (exceedsAvailability
                        ? `Only ${availableQuantity} ${availableUnit} ${availableQuantity === 1 ? 'is' : 'are'} currently available. Please reduce your requested quantity.`
                        : '')
                      return (
                        <>
                    <p className="text-lg font-bold text-slate-900">{donation.food_name}</p>
                    <p className="mt-1 text-sm text-slate-600">{donation.quantity} {donation.quantity_unit} • {donation.city}</p>
                    <p className={`mt-1 text-sm font-medium ${expiryToneClass(donation.available_until)}`}>Food expiry: {foodExpiryDateTime(donation.available_until)}</p>
                    <p className="mt-1 text-sm text-slate-600">Pickup available until: {pickupDeadlineDateTime(donation.pickup_available_until)}</p>
                    <p className="mt-2 text-xs text-slate-500">Pickup area: {donation.city || 'Shared after request approval'}</p>
                    <label className="mt-3 block text-xs font-semibold text-slate-700">
                      Delivery / Drop-off Location
                      <input
                        value={requestDeliveryLocations[donation.id] || ''}
                        onChange={(event) => {
                          setRequestDeliveryLocations((current) => ({ ...current, [donation.id]: event.target.value }))
                          setRequestFeedback((current) => {
                            const next = { ...current }
                            delete next[donation.id]
                            return next
                          })
                        }}
                        className="input-shell mt-1"
                        placeholder="Full address and city"
                        required
                      />
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className="text-xs font-semibold text-slate-700">
                        Request Priority
                        <select
                          value={requestSchedules[donation.id]?.priority || 'medium'}
                          onChange={(event) => setRequestSchedules((current) => ({
                            ...current,
                            [donation.id]: {
                              ...(current[donation.id] || { priority: 'medium', required_date: '', required_time: '' }),
                              priority: event.target.value as 'high' | 'medium' | 'low',
                            },
                          }))}
                          className="input-shell mt-1"
                          disabled={isSubmittingRequest}
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-700">
                        Required Date
                        <input
                          type="date"
                          min={localDateInputValue()}
                          value={requestSchedules[donation.id]?.required_date || ''}
                          onChange={(event) => setRequestSchedules((current) => ({
                            ...current,
                            [donation.id]: {
                              ...(current[donation.id] || { priority: 'medium', required_date: '', required_time: '' }),
                              required_date: event.target.value,
                            },
                          }))}
                          className="input-shell mt-1"
                          disabled={isSubmittingRequest}
                          required
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-700">
                        Required Time
                        <input
                          type="time"
                          value={requestSchedules[donation.id]?.required_time || ''}
                          onChange={(event) => setRequestSchedules((current) => ({
                            ...current,
                            [donation.id]: {
                              ...(current[donation.id] || { priority: 'medium', required_date: '', required_time: '' }),
                              required_time: event.target.value,
                            },
                          }))}
                          className="input-shell mt-1"
                          disabled={isSubmittingRequest}
                          required
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs font-semibold text-slate-700">
                      Requested amount ({donation.quantity_unit})
                      <input type="number" min="0.01" step="any" max={availableQuantity} value={requestedValue} disabled={isSubmittingRequest} onChange={(event) => {
                        setRequestQuantities((current) => ({ ...current, [donation.id]: event.target.value }))
                        setRequestErrors((current) => ({ ...current, [donation.id]: '' }))
                        setRequestFeedback((current) => {
                          const next = { ...current }
                          delete next[donation.id]
                          return next
                        })
                      }} className="input-shell mt-1" aria-describedby={`request-availability-${donation.id}`} />
                    </label>
                    <div id={`request-availability-${donation.id}`} className="mt-2 text-xs text-slate-600">
                      <p>{availableQuantity} {availableUnit} currently available.</p>
                      <p className="mt-1">You can request up to {availableQuantity} {availableUnit}.</p>
                      {requestError && <p className="mt-1 font-medium text-red-700" role="alert">{requestError}</p>}
                      {requestFeedback[donation.id] && (
                        <p className={`mt-1 font-medium ${requestFeedback[donation.id].type === 'success' ? 'text-emerald-700' : 'text-red-700'}`} role={requestFeedback[donation.id].type === 'success' ? 'status' : 'alert'}>
                          {requestFeedback[donation.id].text}
                        </p>
                      )}
                    </div>
                    <button type="button" onClick={() => void handleRequestDonation(donation)} disabled={availableQuantity <= 0 || exceedsAvailability || isSubmittingRequest} className="primary-btn mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">
                      {isSubmittingRequest ? <LoaderCircle className="animate-spin" size={14} /> : <HandHeart size={14} />}
                      {isSubmittingRequest ? 'Submitting…' : 'Request food'}
                    </button>
                        </>
                      )
                    })()}
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No food donations are available right now.</p>}
        </section>

        <section id="requests" className="section-shell rounded-[28px] p-5">
          <h2 className="text-2xl font-bold text-slate-900">My request history</h2>
          {requestHistoryItems.length ? (
            <div className="mt-5 space-y-3">
              {[...requestHistoryItems]
                .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                .map((request) => (
                <article key={request.id} className={`rounded-2xl border p-4 ${request.priority === 'high' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {request.donation && <DonationImage donation={request.donation} className="h-14 w-14 shrink-0 rounded-xl object-cover" />}
                      <div>
                      <p className="font-semibold text-slate-900">{request.donation?.food_name || request.food_name || request.purpose}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {request.requested_quantity} {request.quantity_unit || ''} requested · {request.contributed_quantity || 0} contributed · {request.delivered_quantity || 0} delivered · {request.remaining_to_deliver_quantity ?? request.requested_quantity} remaining
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${requestPriorityClass(request.priority)}`}>{request.priority || 'Priority not specified'}</span>
                        <span className="text-xs text-slate-600">Required by: {requiredDateTimeLabel(request.required_date, request.required_time)}</span>
                      </div>
                      {request.donation && <p className={`mt-1 text-sm font-medium ${expiryToneClass(request.donation.available_until)}`}>Food expiry: {foodExpiryDateTime(request.donation.available_until)}</p>}
                      {request.donation && <p className="mt-1 text-sm text-slate-600">Pickup available until: {pickupDeadlineDateTime(request.donation.pickup_available_until)}</p>}
                      <p className="mt-1 text-xs text-slate-500">Delivery / Drop-off Location: {request.delivery_location || 'Not provided'}</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-[#edf8ef] px-3 py-1 text-xs font-semibold text-[#1d4d3d]">{formatRequestStatus(request.status)}</span>
                  </div>
                  <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500" aria-label="Request status history">
                    {(request.status_history?.length ? request.status_history : [{ status: request.status, created_at: request.updated_at }]).map((entry, index) => (
                      <li key={`${entry.status}-${entry.created_at}-${index}`}>{formatRequestStatus(entry.status)} · {new Date(entry.created_at).toLocaleString()}</li>
                    ))}
                  </ol>
                  {request.delivery_tasks?.filter((task) => task.status === 'delivered').map((task) => {
                    const feedback = task.feedback?.[0]
                    const issue = task.issues?.[0]
                    return (
                      <div key={task.id} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-600"><Truck size={14} />Delivered · {task.id}</span>
                        {feedback
                          ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800"><BadgeCheck size={14} />Feedback submitted ({feedback.rating}/5)</span>
                          : task.feedback_submitted
                            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800"><BadgeCheck size={14} />Feedback submitted</span>
                          : <span className="text-xs text-slate-500">Feedback not submitted</span>}
                        {(!task.feedback_submitted || feedback) && <button type="button" onClick={() => { setFeedbackDialogMode('feedback'); setFeedbackDeliveryTaskId(task.id) }} className="secondary-btn px-3 py-1.5 text-xs font-semibold">
                          <span className="inline-flex items-center gap-1"><MessageCircle size={14} />{feedback ? 'View feedback' : 'Give Feedback'}</span>
                        </button>}
                        {issue
                          ? <Link to={`/delivery-issues/${encodeURIComponent(issue.id)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900 underline"><Flag size={14} />Issue reported · {formatStatus(issue.status)} · View</Link>
                          : <button type="button" onClick={() => { setFeedbackDialogMode('issue'); setFeedbackDeliveryTaskId(task.id) }} className="secondary-btn inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold"><Flag size={14} />Report an Issue</button>}
                        {feedback && (
                          <div className="w-full rounded-lg border border-emerald-100 bg-white p-3 text-xs text-slate-700">
                            <p className="flex items-center gap-1 font-semibold text-emerald-900" aria-label={`Rating ${feedback.rating} out of 5`}>
                              {Array.from({ length: 5 }, (_, index) => <Star key={index} size={14} className={index < feedback.rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'} />)}
                              <span className="ml-1">{feedback.rating}/5 · {feedback.created_at ? new Date(feedback.created_at).toLocaleString() : 'Date not recorded'}</span>
                            </p>
                            <p className="mt-2"><span className="font-semibold">Food condition:</span> {feedback.food_condition_feedback || 'Not recorded'}</p>
                            <p className="mt-1"><span className="font-semibold">Delivery experience:</span> {feedback.delivery_experience_feedback || feedback.comment || 'Not recorded'}</p>
                            {feedback.appreciation_message && <p className="mt-1"><span className="font-semibold">Appreciation:</span> {feedback.appreciation_message}</p>}
                            {(feedback.comments || feedback.comment) && <p className="mt-1"><span className="font-semibold">Comments:</span> {feedback.comments || feedback.comment}</p>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {(request.status === 'approved' || request.status === 'completed') && request.donation && (
                    <div className="mt-4 rounded-xl bg-[#f4f7f1] p-3 text-sm text-slate-700">
                      <p className="font-semibold">Pickup instructions</p>
                      <p className="mt-1">{request.donation.pickup_location}, {request.donation.city}</p>
                      {request.donation.handling_instructions && <p className="mt-1">{request.donation.handling_instructions}</p>}
                      {request.donation.contact_name && <p className="mt-1">Contact: {request.donation.contact_name}{request.donation.contact_phone ? ` · ${request.donation.contact_phone}` : ''}</p>}
                    </div>
                  )}
                  {request.contributions?.length ? (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      <p className="text-xs font-semibold text-slate-600">Donor contributions and delivery progress</p>
                      {request.contributions.map((contribution) => (
                        <div key={contribution.id} className="flex items-center gap-2 text-xs text-slate-600">
                          <DonationImage donation={contribution} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                          <p>{contribution.quantity} {contribution.quantity_unit} · {contribution.donor_name || 'Donor'} · {contribution.delivery_status ? formatStatus(contribution.delivery_status) : formatStatus(contribution.status)} · Food expiry: {foodExpiryDateTime(contribution.available_until)} · Pickup available until: {pickupDeadlineDateTime(contribution.pickup_available_until)}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {['pending', 'approved'].includes(request.status) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => cancelRequest(request.id)} className="secondary-btn px-3 py-2 text-xs font-semibold">Cancel request</button>
                      {request.status === 'pending' && (
                        <button type="button" onClick={() => void deleteRequest(request.id)} className="secondary-btn px-3 py-2 text-xs font-semibold text-red-700">Delete request</button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">You have not submitted any food requests yet.</p>}
          {message && <p className="mt-4 text-sm text-[#1d4d3d]" role="status">{message}</p>}
        </section>
        {feedbackDeliveryTaskId && (
          <DeliveryFeedbackDialog
            taskId={feedbackDeliveryTaskId}
            initialMode={feedbackDialogMode}
            onClose={() => setFeedbackDeliveryTaskId(null)}
            onSubmitted={onReload}
          />
        )}
      </div>
    )
  }

  if (user.role === 'volunteer') {
    const availableTasks = deliveryTasks.filter((task) => task.status === 'open')
    const myTasks = deliveryTasks.filter((task) => task.volunteer_id === user.id)
    const activeTasks = myTasks.filter((task) => task.status !== 'delivered' && task.status !== 'cancelled')
    const completedTasks = myTasks.filter((task) => task.status === 'delivered')
    const cancelledTasks = myTasks.filter((task) => task.status === 'cancelled')
    const completedCount = completedTasks.length
    const badges = [
      { label: 'First Delivery', target: 1 },
      { label: '5 Deliveries', target: 5 },
      { label: '10 Deliveries', target: 10 },
    ]
    const monthStart = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth(), 1)
    const monthDays = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() + 1, 0).getDate()
    const calendarCells: Array<number | null> = [
      ...Array.from({ length: monthStart.getDay() }, () => null),
      ...Array.from({ length: monthDays }, (_, index) => index + 1),
    ]
    return (
      <div id="overview" className="space-y-6">
        <section className="grid gap-4 md:grid-cols-3">
          {volunteerStats.map(({ label, value, accent }) => (
            <div key={label} className="metric-card section-shell rounded-[28px] p-5">
              <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}><Users size={18} /></div>
              <p className="text-3xl font-black text-slate-900">{value}</p>
              <p className="mt-2 text-sm text-slate-600">{label}</p>
            </div>
          ))}
        </section>
        {message && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
        <section id="tasks" className="section-shell rounded-[28px] p-5">
          <h2 className="text-2xl font-bold text-slate-900">Available delivery tasks</h2>
          {availableTasks.length ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {availableTasks.map((task) => (
                <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <DonationImage donation={task} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                    <p className="text-lg font-bold text-slate-900">{task.food_name || 'Food pickup and delivery'}</p>
                  </div>
                  <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
                    {task.quantity && (
                      <p className="flex items-center gap-2 text-slate-600">
                        <Package size={16} className="shrink-0 text-[#1d4d3d]" />
                        <span>Food Quantity: {task.quantity} {task.quantity_unit}</span>
                      </p>
                    )}
                    <p className="flex items-center gap-2 text-slate-600">
                      <Clock3 size={16} className="shrink-0 text-[#1d4d3d]" />
                      <span>Pickup Available Until: {pickupDeadlineDateTime(task.pickup_available_until)}</span>
                    </p>
                    <p className="flex items-center gap-2 text-amber-800">
                      <CalendarDays size={16} className="shrink-0" />
                      <span>Food Expiry: {foodExpiryDateTime(task.available_until)}</span>
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <section className="rounded-xl border border-slate-200 p-3">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <MapPin size={16} className="shrink-0 text-[#1d4d3d]" />
                        Pickup Location
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">{task.pickup_location}</p>
                      {task.pickup_instructions && (
                        <p className="mt-2 flex items-start gap-2 text-xs text-slate-500">
                          <FileText size={14} className="mt-0.5 shrink-0" />
                          <span>Pickup Notes: {task.pickup_instructions}</span>
                        </p>
                      )}
                    </section>
                    <section className="rounded-xl border border-slate-200 p-3">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <Flag size={16} className="shrink-0 text-[#1d4d3d]" />
                        Drop-off Location
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">{task.dropoff_location}</p>
                      {task.dropoff_instructions && (
                        <p className="mt-2 flex items-start gap-2 text-xs text-slate-500">
                          <FileText size={14} className="mt-0.5 shrink-0" />
                          <span>Drop-off Notes: {task.dropoff_instructions}</span>
                        </p>
                      )}
                    </section>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(task.pickup_location)}&destination=${encodeURIComponent(task.dropoff_location)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-[#1d4d3d] underline">
                      <MapIcon size={16} />
                      View Route
                    </a>
                    <button type="button" onClick={() => void acceptDeliveryTask(task.id)} disabled={acceptingTaskId === task.id} className="primary-btn inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold disabled:opacity-60">
                      <CheckCircle2 size={16} />
                      {acceptingTaskId === task.id ? 'Assigning…' : 'Assign to Me'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">There are no unassigned delivery tasks right now.</p>}
        </section>
        <section id="my-deliveries" className="section-shell rounded-[28px] p-5">
          <h2 className="text-2xl font-bold text-slate-900">My deliveries</h2>
          {[...activeTasks, ...completedTasks].length ? (
            <div className="mt-5 space-y-3">
              {[...activeTasks, ...completedTasks].map((task) => (
                <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <DonationImage donation={task} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                      <div>
                      <p className="font-semibold text-slate-900">{task.food_name || 'Delivery'} · Pickup: {task.pickup_location}</p>
                      <p className="mt-1 text-sm text-slate-600">Drop-off: {task.dropoff_location}</p>
                      <a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(task.pickup_location)}&destination=${encodeURIComponent(task.dropoff_location)}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-[#1d4d3d] underline">View Route</a>
                      </div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusToneClass(task.status)}`}>{formatStatus(task.status)}</span>
                  </div>
                  {task.status !== 'delivered' && (
                    task.status === 'assigned' ? (
                      <button type="button" onClick={() => void acceptDeliveryTask(task.id)} disabled={acceptingTaskId === task.id} className="primary-btn mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold disabled:opacity-60"><CheckCircle2 size={14} />{acceptingTaskId === task.id ? 'Assigning…' : 'Accept assigned delivery'}</button>
                    ) : task.status !== 'open' && (
                      <button type="button" onClick={() => advanceDeliveryTask(task)} className="primary-btn mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold">
                        {task.status === 'accepted' ? <PackageCheck size={14} /> : task.status === 'picked_up' ? <Truck size={14} /> : <CheckCircle2 size={14} />}
                        {task.status === 'accepted' ? 'Mark picked up' : task.status === 'picked_up' ? 'Mark in transit' : 'Mark delivered'}
                      </button>
                    )
                  )}
                  {editingRouteId === task.id ? (
                    <form onSubmit={(event) => saveRoute(event, task.id)} className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3">
                      <label className="text-xs font-semibold text-slate-700">Pickup address<input value={routeForm.pickup_location} onChange={(event) => setRouteForm((current) => ({ ...current, pickup_location: event.target.value }))} className="input-shell mt-1" required /></label>
                      <label className="text-xs font-semibold text-slate-700">Drop-off address<input value={routeForm.dropoff_location} onChange={(event) => setRouteForm((current) => ({ ...current, dropoff_location: event.target.value }))} className="input-shell mt-1" required /></label>
                      <div className="flex gap-2">                      <button type="submit" className="primary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold"><Save size={13} />Save route</button><button type="button" onClick={cancelRouteEdit} className="secondary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold"><X size={13} />Cancel</button></div>
                    </form>
                  ) : (
                    <button type="button" onClick={() => startRouteEdit(task)} className="secondary-btn mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold"><Pencil size={14} />Edit addresses</button>
                  )}
                  {task.feedback?.length ? (
                    <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Receiver / organization feedback</p>
                      {task.feedback.map((feedback) => (
                        <div key={feedback.id} className="rounded-xl bg-[#f4f7f1] p-3 text-sm">
                          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
                            <span>{feedback.author_name || 'Food receiver'}</span>
                            <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${feedback.rating} out of 5 stars`}>
                              {Array.from({ length: 5 }, (_, index) => <Star key={index} size={13} className={index < feedback.rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'} />)}
                            </span>
                          </p>
                          {feedback.food_condition_feedback && <p className="mt-1 text-slate-600"><span className="font-medium">Food condition:</span> {feedback.food_condition_feedback}</p>}
                          <p className="mt-1 text-slate-600"><span className="font-medium">Delivery experience:</span> {feedback.delivery_experience_feedback || feedback.comment}</p>
                          {(feedback.comments || feedback.comment) && <p className="mt-1 text-slate-600"><span className="font-medium">Comments:</span> {feedback.comments || feedback.comment}</p>}
                        </div>
                      ))}
                    </div>
                  ) : task.status === 'delivered' && <p className="mt-3 text-xs text-slate-500">No feedback has been submitted yet.</p>}
                  {task.issues?.length ? (
                    <div className="mt-4 border-t border-amber-100 pt-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-900">Delivery issue</p>
                      {task.issues.map((issue) => (
                        <div key={issue.id} className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                          <p>{issue.description}</p>
                          <p className="mt-1 text-xs font-semibold">Status: {formatStatus(issue.status)} · {new Date(issue.created_at).toLocaleString()}</p>
                          <p className="mt-1 text-xs text-amber-900">Request {issue.request_id} · Delivery {issue.delivery_id}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">You have no active or completed deliveries.</p>}
        </section>
        {cancelledTasks.length > 0 && (
          <section className="section-shell rounded-[28px] p-5">
            <h2 className="text-xl font-bold text-slate-900">Cancelled delivery history</h2>
            <div className="mt-3 space-y-2">
              {cancelledTasks.map((task) => (
                <article key={task.id} className="rounded-xl border border-red-200 bg-red-50/50 p-3">
                  <p className="font-semibold text-slate-800">{task.food_name || 'Delivery'} · {task.id}</p>
                  <p className="mt-1 text-xs text-slate-600">This task was cancelled and is no longer active. {task.cancellation_reason || ''}</p>
                  {task.cancelled_at && <p className="mt-1 text-xs text-slate-500">Cancelled: {new Date(task.cancelled_at).toLocaleString()}</p>}
                </article>
              ))}
            </div>
          </section>
        )}
        <section className="grid gap-6 xl:grid-cols-2">
          <div className="section-shell rounded-[28px] p-5">
            <h2 className="text-2xl font-bold text-slate-900">Achievements and certificate</h2>
            <p className="mt-2 text-sm text-slate-600">Based on {completedCount} completed delivery{completedCount === 1 ? '' : 'ies'} in your saved delivery records.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {badges.map((badge) => {
                const earned = completedCount >= badge.target
                return <div key={badge.target} className={`rounded-2xl border p-4 ${earned ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}><p className="text-sm font-bold text-slate-900">{badge.label}</p><p className={`mt-1 text-xs ${earned ? 'text-emerald-700' : 'text-slate-500'}`}>{earned ? 'Earned' : `${badge.target - completedCount} more ${badge.target - completedCount === 1 ? 'delivery' : 'deliveries'} needed`}</p></div>
              })}
            </div>
            {certificateIssueDate && <p className="mt-4 text-sm text-slate-600">Certificate generated for {user.full_name} on {certificateIssueDate} ({certificateDeliveryCount} completed {(certificateDeliveryCount ?? 0) === 1 ? 'delivery' : 'deliveries'}).</p>}
            {certificateError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{certificateError}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void generateCertificate(completedCount)} disabled={certificateGenerating} className="secondary-btn px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-60">{certificateGenerating ? 'Generating…' : 'Generate Certificate'}</button>
              <button type="button" onClick={() => setCertificatePreviewOpen(true)} disabled={!volunteerCertificateHtml} className="secondary-btn px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">Preview</button>
              <button type="button" onClick={() => void downloadVolunteerCertificate()} disabled={!volunteerCertificateHtml || certificateDownloading} className="primary-btn px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{certificateDownloading ? 'Preparing PDF…' : 'Download Certificate'}</button>
            </div>
          </div>
          <div className="section-shell rounded-[28px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-2xl font-bold text-slate-900">Volunteer leaderboard</h2><p className="mt-1 text-sm text-slate-600">Ranked by actual completed delivery records.</p></div>
            </div>
            <div className="mt-4 space-y-2">
              {leaderboard.map((entry) => <div key={entry.volunteer_id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${entry.volunteer_id === user.id ? 'bg-[#edf8ef]' : 'bg-slate-50'}`}><div><span className="mr-3 text-sm font-bold text-[#1d4d3d]">#{entry.rank}</span><span className="text-sm font-semibold text-slate-800">{entry.name}{entry.volunteer_id === user.id ? ' (you)' : ''}</span></div><span className="text-xs text-slate-600">{entry.completed_deliveries} completed</span></div>)}
              {!leaderboard.length && <p className="text-sm text-slate-500">No volunteer profiles are available.</p>}
            </div>
          </div>
          {certificatePreviewOpen && volunteerCertificateHtml && (
            <div className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 sm:p-6" role="presentation">
              <div className="relative my-auto w-full max-w-6xl overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="volunteer-certificate-preview-title">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#1d4d3d]">Volunteer appreciation</p>
                    <h3 id="volunteer-certificate-preview-title" className="mt-1 text-lg font-bold text-slate-900">Certificate Preview</h3>
                  </div>
                  <button type="button" onClick={() => setCertificatePreviewOpen(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close certificate preview"><X size={20} /></button>
                </div>
                <div className="max-h-[70vh] overflow-auto bg-[#eeece5] p-3 sm:p-6">
                  <iframe
                    title={`Certificate of Appreciation for ${user.full_name}`}
                    srcDoc={volunteerCertificateHtml}
                    className="mx-auto block border-0 shadow-lg"
                    style={{ width: 'min(100%, calc(68vh * 1.4142))', aspectRatio: '297 / 210' }}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 p-4">
                  <button type="button" onClick={() => void downloadVolunteerCertificate()} disabled={certificateDownloading} className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60">{certificateDownloading ? <LoaderCircle className="animate-spin" size={15} /> : <Download size={15} />}{certificateDownloading ? 'Preparing PDF…' : 'Download PDF'}</button>
                  <button type="button" onClick={() => setCertificatePreviewOpen(false)} className="secondary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><X size={15} />Close</button>
                </div>
              </div>
            </div>
          )}
        </section>
        <section className="section-shell rounded-[28px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><CalendarDays size={21} className="text-[#1d4d3d]" />Availability calendar</h2><p className="mt-1 text-sm text-slate-600">Only you can view and change your availability entries.</p></div>
            <div className="flex items-center gap-2"><button type="button" onClick={() => setAvailabilityMonth(new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() - 1, 1))} className="secondary-btn px-3 py-2 text-sm" aria-label="Previous month"><ChevronLeft size={16} /></button><span className="min-w-32 text-center text-sm font-semibold text-slate-800">{availabilityMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><button type="button" onClick={() => setAvailabilityMonth(new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() + 1, 1))} className="secondary-btn px-3 py-2 text-sm" aria-label="Next month"><ChevronRight size={16} /></button></div>
          </div>
          <form onSubmit={saveAvailability} className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
            <label className="text-sm font-medium text-slate-700">Date<input type="date" value={availabilityForm.date} onChange={(event) => setAvailabilityForm((current) => ({ ...current, date: event.target.value }))} className="input-shell mt-1" required /></label>
            <label className="text-sm font-medium text-slate-700">Status<select value={availabilityForm.status} onChange={(event) => setAvailabilityForm((current) => ({ ...current, status: event.target.value as AvailabilityEntry['status'] }))} className="input-shell mt-1"><option value="available">Available</option><option value="unavailable">Unavailable</option></select></label>
            <button type="submit" disabled={savingAvailability} className="primary-btn inline-flex items-center justify-center gap-2 self-end px-4 py-2 text-sm font-semibold disabled:opacity-60">{savingAvailability ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}{savingAvailability ? 'Saving…' : 'Save'}</button>
            {editingAvailabilityId && <button type="button" onClick={() => { setEditingAvailabilityId(null); setAvailabilityForm({ date: localDateInputValue(), status: 'available', notes: '' }) }} className="secondary-btn inline-flex items-center justify-center gap-2 self-end px-4 py-2 text-sm font-semibold"><X size={15} />Cancel</button>}
            <label className="text-sm font-medium text-slate-700 sm:col-span-4">Notes (optional)<input value={availabilityForm.notes} onChange={(event) => setAvailabilityForm((current) => ({ ...current, notes: event.target.value }))} maxLength={500} className="input-shell mt-1" placeholder="Add any availability details" /></label>
          </form>
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="py-2 font-semibold text-slate-500">{day}</div>)}
            {calendarCells.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="min-h-16 rounded-lg bg-slate-50/60" />
              const dayDate = `${availabilityMonth.getFullYear()}-${String(availabilityMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const entry = availability.find((item) => item.date === dayDate)
              return <div key={dayDate} className={`min-h-16 rounded-lg border p-1 text-left ${entry?.status === 'available' ? 'border-emerald-200 bg-emerald-50' : entry ? 'border-rose-200 bg-rose-50' : 'border-slate-100 bg-white'}`}><span className="font-semibold text-slate-700">{day}</span>{entry && <div className="mt-1 truncate text-[10px] font-medium">{entry.status === 'available' ? 'Available' : 'Unavailable'}</div>}</div>
            })}
          </div>
          {availability.length > 0 && <div className="mt-4 space-y-2">{availability.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3"><div><p className="text-sm text-slate-700">{new Date(`${entry.date}T00:00:00`).toLocaleDateString()} · <span className="font-semibold">{entry.status === 'available' ? 'Available' : 'Unavailable'}</span></p>{entry.notes && <p className="mt-1 text-xs text-slate-500">{entry.notes}</p>}</div><div className="flex gap-2"><button type="button" onClick={() => editAvailability(entry)} className="secondary-btn inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold"><Pencil size={13} />Edit</button><button type="button" onClick={() => void deleteAvailability(entry)} className="secondary-btn inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold"><Trash2 size={13} />Delete</button></div></div>)}</div>}
        </section>
      </div>
    )
  }

  return (
    <div id="overview" className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ngoStats.map(({ label, value, accent }) => (
          <div key={label} className="metric-card section-shell rounded-[28px] p-5">
            <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>
              <HeartHandshake size={18} />
            </div>
            <p className="text-3xl font-black text-slate-900">{value}</p>
            <p className="mt-2 text-sm text-slate-600">{label}</p>
          </div>
        ))}
      </section>

      <div className="space-y-6">
        <section id="volunteer-availability" className="section-shell rounded-[28px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Volunteer Availability Calendar</h2>
              <p className="mt-1 text-sm text-slate-600">Read-only calendar of availability saved by all registered volunteers.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setAvailabilityMonth(new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() - 1, 1))} className="secondary-btn px-3 py-2 text-sm" aria-label="Previous month"><ChevronLeft size={16} /></button>
              <span className="min-w-36 text-center text-sm font-semibold text-slate-800">{availabilityMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
              <button type="button" onClick={() => setAvailabilityMonth(new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() + 1, 1))} className="secondary-btn px-3 py-2 text-sm" aria-label="Next month"><ChevronRight size={16} /></button>
              <button type="button" onClick={handleRefreshAvailability} disabled={availabilityLoading} className="secondary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold disabled:opacity-60">{availabilityLoading ? <LoaderCircle className="animate-spin" size={14} /> : <RotateCw size={14} />}{availabilityLoading ? 'Refreshing…' : 'Refresh'}</button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">Volunteer name
              <input value={availabilityNameFilter} onChange={(event) => setAvailabilityNameFilter(event.target.value)} className="input-shell mt-1" placeholder="Filter by volunteer" />
            </label>
            <label className="text-sm font-medium text-slate-700">Date
              <input type="date" value={availabilityDateFilter} onChange={(event) => {
                setAvailabilityDateFilter(event.target.value)
                if (event.target.value) {
                  setSelectedAvailabilityDate(event.target.value)
                  const date = new Date(`${event.target.value}T00:00:00`)
                  setAvailabilityMonth(new Date(date.getFullYear(), date.getMonth(), 1))
                }
              }} className="input-shell mt-1" />
            </label>
            <label className="text-sm font-medium text-slate-700">Availability status
              <select value={availabilityStatusFilter} onChange={(event) => setAvailabilityStatusFilter(event.target.value as typeof availabilityStatusFilter)} className="input-shell mt-1">
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </label>
          </div>

          {availabilityError && <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><span>{availabilityError}</span><button type="button" onClick={handleRefreshAvailability} className="font-semibold underline">Try again</button></div>}
          {availabilityLoading ? (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Loading volunteer availability…</p>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-7 gap-1 text-center text-xs">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="py-2 font-semibold text-slate-500">{day}</div>)}
                {ngoCalendarCells.map((day, index) => {
                  if (!day) return <div key={`ngo-empty-${index}`} className="min-h-24 rounded-lg bg-slate-50/60" />
                  const dayDate = `${availabilityMonth.getFullYear()}-${String(availabilityMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const entriesForDay = filteredAvailability.filter((entry) => entry.date === dayDate)
                  const hasAvailable = entriesForDay.some((entry) => entry.status === 'available')
                  const hasUnavailable = entriesForDay.some((entry) => entry.status === 'unavailable')
                  return (
                    <button key={dayDate} type="button" onClick={() => { setSelectedAvailabilityDate(dayDate); setAvailabilityDateFilter('') }} aria-pressed={selectedAvailabilityDate === dayDate} className={`min-h-24 rounded-lg border p-1 text-left ${selectedAvailabilityDate === dayDate ? 'border-[#1d4d3d] ring-2 ring-[#1d4d3d]/20' : 'border-slate-100'} ${hasAvailable && !hasUnavailable ? 'bg-emerald-50' : hasUnavailable && !hasAvailable ? 'bg-rose-50' : hasAvailable && hasUnavailable ? 'bg-amber-50' : 'bg-white'}`}>
                      <span className="font-semibold text-slate-700">{day}</span>
                      {entriesForDay.slice(0, 2).map((entry) => <span key={entry.id} className="mt-1 block truncate text-left text-[10px] text-slate-600">{entry.volunteer_name}: {entry.status === 'available' ? 'Available' : 'Unavailable'}</span>)}
                      {entriesForDay.length > 2 && <span className="mt-1 block text-[10px] font-semibold text-slate-500">+{entriesForDay.length - 2} more</span>}
                    </button>
                  )
                })}
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-lg font-bold text-slate-900">Volunteers on {new Date(`${selectedAvailabilityDate}T00:00:00`).toLocaleDateString()}</h3>
                {availability.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No volunteer availability entries have been saved yet.</p>
                ) : selectedDateAvailability.length ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {selectedDateAvailability.map((entry) => (
                      <article key={entry.id} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900">{entry.volunteer_name || 'Volunteer'}</p>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.status === 'available' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{entry.status === 'available' ? 'Available' : 'Unavailable'}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{entry.date} · Volunteer ID: {entry.volunteer_id}</p>
                        {entry.notes && <p className="mt-2 text-sm text-slate-600">{entry.notes}</p>}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">{filteredAvailability.length ? 'No volunteers have an entry on this date with the selected filters.' : 'No availability entries match these filters.'}</p>
                )}
              </div>
            </>
          )}
        </section>

        <div id="requests" className="section-shell rounded-[28px] p-5">
          <h2 className="text-2xl font-bold text-slate-900">Food request coordination</h2>
          {donationCancellations.length > 0 && (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Cancelled donations and alternatives</h3>
              {donationCancellations.map((cancellation) => (
                <article key={cancellation.id} className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{cancellation.donation.food_name} · Cancelled donation</p>
                      <p className="mt-1 text-xs text-slate-600">Donation ID: {cancellation.donation_id} · Donor: {cancellation.donor_name}</p>
                      <p className="mt-1 text-sm text-red-800">Reason: {cancellation.reason}</p>
                      <p className="mt-1 text-xs text-slate-500">Cancelled: {new Date(cancellation.created_at).toLocaleString()}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-700">Alternative status: {formatStatus(cancellation.reassignment_status)}</p>
                      {cancellation.requests.map((relatedRequest) => (
                        <p key={relatedRequest.id} className="mt-1 text-xs text-slate-600">
                          Request {relatedRequest.id}: {relatedRequest.food_name} · {relatedRequest.requested_quantity} {relatedRequest.quantity_unit || ''} · {formatRequestStatus(relatedRequest.status)}
                        </p>
                      ))}
                    </div>
                    {cancellation.requests.some((item) => !['fulfilled', 'completed', 'cancelled', 'rejected'].includes(item.status))
                      && cancellation.coordinating_ngo_id !== user.id && (
                      <button type="button" onClick={() => void coordinateDonationCancellation(cancellation)} className="primary-btn px-3 py-2 text-xs font-semibold">
                        Coordinate alternative
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {coordinationRequests.length ? (
            <div className="mt-5 space-y-3">
              {[...coordinationRequests]
                .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                .map((request) => (
                <div key={request.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {request.donation && <DonationImage donation={request.donation} className="h-14 w-14 shrink-0 rounded-xl object-cover" />}
                      <div>
                      <p className="font-semibold text-slate-800">{request.donation?.food_name || request.food_name || request.purpose}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Requested {request.requested_quantity} {request.quantity_unit || ''} · Contributed {request.contributed_quantity || 0} · Delivered {request.delivered_quantity || 0} · Remaining {request.remaining_to_deliver_quantity ?? request.requested_quantity}
                      </p>
                      {request.donation && (
                        <p className="mt-1 text-xs text-slate-600">
                          Donation: {request.donation.quantity ?? 'Not specified'} {request.donation.quantity_unit || request.quantity_unit || ''}
                          {' · Donor: '}{request.donation.donor_organization || request.donation.donor_name || 'Not specified'}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${requestPriorityClass(request.priority)}`}>{request.priority || 'Priority not specified'}</span>
                        <span className="text-xs text-slate-600">Required by: {requiredDateTimeLabel(request.required_date, request.required_time)}</span>
                      </div>
                      {request.donation?.status && <p className="mt-1 text-xs text-slate-500">Donation status: {formatStatus(request.donation.status)}</p>}
                      {request.donation && <p className={`mt-1 text-xs font-medium ${expiryToneClass(request.donation.available_until)}`}>Food expiry: {foodExpiryDateTime(request.donation.available_until)}</p>}
                      {request.donation && <p className="mt-1 text-xs text-slate-600">Pickup available until: {pickupDeadlineDateTime(request.donation.pickup_available_until)}</p>}
                      <p className="mt-1 text-xs text-slate-500">Delivery / Drop-off Location: {request.delivery_location || 'Not provided'}</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{formatRequestStatus(request.status)}</span>
                  </div>
                  {request.multi_contribution && !request.coordinating_ngo_id && request.status !== 'fulfilled' && (
                    <button type="button" onClick={() => updateRequestStatus(request.id, 'approved')} className="primary-btn mt-3 px-3 py-2 text-xs font-semibold">
                      Take delivery coordination
                    </button>
                  )}
                  {request.requester_id && !request.multi_contribution && request.status === 'pending' && !request.coordinating_ngo_id && (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => updateRequestStatus(request.id, 'approved')} className="primary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold"><CheckCircle2 size={13} />Approve</button>
                      <button type="button" onClick={() => updateRequestStatus(request.id, 'rejected')} className="secondary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold"><X size={13} />Reject</button>
                    </div>
                  )}
                  {request.requester_id && request.status === 'approved' && !request.coordinating_ngo_id && (
                    <button type="button" onClick={() => updateRequestStatus(request.id, 'approved')} className="primary-btn mt-3 inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold"><HeartHandshake size={14} />Take distribution coordination</button>
                  )}
                  {request.coordinating_ngo_id === user.id && <p className="mt-2 text-xs font-medium text-[#1d4d3d]">Coordinated by your organization</p>}
                  {request.contributions?.length ? (
                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-3">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Donor contributions</h3>
                      {request.contributions.map((contribution) => (
                        <div key={contribution.id} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <DonationImage donation={contribution} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                              <p className="text-sm font-semibold text-slate-800">{contribution.donor_name || 'Donor'} · {contribution.quantity} {contribution.quantity_unit}</p>
                            </div>
                            <span className="text-xs font-medium text-slate-600">{contribution.delivery_status ? formatStatus(contribution.delivery_status) : formatStatus(contribution.status)}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{contribution.food_name} · Pickup: {contribution.pickup_location || 'Not provided'}</p>
                          <p className={`mt-1 text-xs font-medium ${expiryToneClass(contribution.available_until)}`}>Food expiry: {foodExpiryDateTime(contribution.available_until)}</p>
                          <p className="mt-1 text-xs text-slate-600">Pickup available until: {pickupDeadlineDateTime(contribution.pickup_available_until)}</p>
                          {contribution.volunteer_name && <p className="mt-1 text-xs text-slate-600">Volunteer: {contribution.volunteer_name}</p>}
                          {contribution.status === 'committed' && !contribution.delivery_task_id && (
                            <div className="mt-3 flex flex-wrap items-end gap-2">
                              <label className="min-w-48 flex-1 text-xs font-semibold text-slate-700">
                                Assign volunteer
                                <select value={needVolunteerSelections[contribution.id] || ''} onChange={(event) => setNeedVolunteerSelections((current) => ({ ...current, [contribution.id]: event.target.value }))} className="input-shell mt-1">
                                  <option value="">Select volunteer</option>
                                  {availableVolunteers.map((volunteer) => <option key={volunteer.id} value={volunteer.id}>{volunteer.full_name}{volunteer.city ? ` · ${volunteer.city}` : ''}</option>)}
                                </select>
                              </label>
                              <button type="button" onClick={() => void assignRequestContribution(request, contribution)} disabled={!availableVolunteers.length || !needVolunteerSelections[contribution.id] || !contribution.pickup_location} className="primary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold disabled:opacity-50"><Truck size={14} />Assign delivery</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : request.multi_contribution ? <p className="mt-3 text-xs text-slate-500">No donor contributions yet.</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No food requests to coordinate.</div>
          )}
        </div>
      </div>

      <section id="deliveries" className="section-shell rounded-[28px] p-5">
        <h2 className="text-2xl font-bold text-slate-900">Delivery progress and distribution history</h2>
        <p className="mt-1 text-sm text-slate-600">Create tasks for approved food requests; volunteers can claim open tasks.</p>
        <form onSubmit={createDeliveryTask} className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Approved request
            <select value={taskForm.request_id} onChange={(event) => {
              const selectedRequest = requests.find((request) => request.id === event.target.value)
              setTaskForm((current) => ({
                ...current,
                request_id: event.target.value,
                dropoff_location: selectedRequest?.delivery_location || '',
              }))
            }} className="input-shell mt-2" required>
              <option value="">Select a request</option>
              {coordinationRequests.filter((item) => item.status === 'approved' && (item.coordinating_ngo_id === user.id || (!item.requester_id && item.ngo_id === user.id)) && !deliveryTasks.some((task) => task.request_id === item.id && task.status !== 'delivered')).map((item) => (
                <option key={item.id} value={item.id}>{item.donation?.food_name || item.purpose} · {item.requested_quantity}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Delivery / Drop-off Location
            <input
              value={taskForm.dropoff_location}
              onChange={(event) => setTaskForm((current) => ({ ...current, dropoff_location: event.target.value }))}
              className="input-shell mt-2"
              readOnly={Boolean(requests.find((request) => request.id === taskForm.request_id)?.requester_id)}
              required
            />
          </label>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">
            Drop-off instructions
            <textarea value={taskForm.dropoff_instructions} onChange={(event) => setTaskForm((current) => ({ ...current, dropoff_instructions: event.target.value }))} className="input-shell mt-2 min-h-[72px]" />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"><Plus size={15} />Create delivery task</button>
          </div>
        </form>
        {message && <p className="mt-3 text-sm text-[#1d4d3d]" role="status">{message}</p>}
        <div className="mt-5 space-y-3">
          {deliveryTasks.map((task) => (
            <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900"><span>{task.pickup_location}</span><ArrowRight size={15} className="text-slate-400" /><span>{task.dropoff_location}</span></p>
                  <p className="mt-1 text-xs text-slate-600">{task.volunteer_name ? `Volunteer: ${task.volunteer_name}` : 'Waiting for a volunteer'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {task.status === 'delivered' ? 'Delivered' : 'Updated'}: {new Date(task.updated_at).toLocaleString()}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusToneClass(task.status)}`}>{formatStatus(task.status)}</span>
              </div>
            </article>
          ))}
          {!deliveryTasks.length && <p className="text-sm text-slate-500">No delivery tasks have been created.</p>}
        </div>
      </section>

      <section id="delivery-feedback" className="section-shell rounded-[28px] p-5">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardList size={22} className="text-[#1d4d3d]" />Delivery Feedback &amp; Issues</h2>
        {deliveryTasks.some((task) => task.feedback?.length || task.issues?.length) ? (
          <div className="mt-4 space-y-3">
            {deliveryTasks.flatMap((task) => (task.feedback || []).map((feedback) => (
              <article key={feedback.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1 font-semibold text-slate-900">
                      <Utensils size={15} />{task.food_name || 'Food delivery'} ·
                      {Array.from({ length: 5 }, (_, index) => <Star key={index} size={14} className={index < feedback.rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'} />)}
                      <span>{feedback.rating}/5</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-600">Request: {feedback.request_id || task.request_id || 'Not linked'} · Donation: {feedback.donation_id || 'Not linked'} · Delivery: {feedback.delivery_id || task.id}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-600"><MapPinned size={14} />Pickup: {task.pickup_location} · Drop-off: {task.dropoff_location}</p>
                    {task.volunteer_name && <p className="mt-1 flex items-center gap-1 text-xs text-slate-600"><Truck size={14} />Volunteer: {task.volunteer_name}</p>}
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><CalendarClock size={14} />Submitted: {feedback.created_at ? new Date(feedback.created_at).toLocaleString() : 'Date not recorded'}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusToneClass(task.status)}`}>{formatStatus(task.status)}</span>
                </div>
                <details className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-slate-700">Food quality and delivery feedback</summary>
                  <p className="mt-2 text-slate-600"><span className="font-medium">Food condition:</span> {feedback.food_condition_feedback || 'Not provided in this older feedback record.'}</p>
                  <p className="mt-1 text-slate-600"><span className="font-medium">Delivery experience:</span> {feedback.delivery_experience_feedback || feedback.comment || 'Not provided.'}</p>
                  {feedback.appreciation_message && <p className="mt-1 text-slate-600"><span className="font-medium">Appreciation:</span> {feedback.appreciation_message}</p>}
                  {(feedback.comments || feedback.comment) && <p className="mt-1 whitespace-pre-wrap text-slate-600"><span className="font-medium">Comments:</span> {feedback.comments || feedback.comment}</p>}
                </details>
              </article>
            )))}
            {deliveryTasks.flatMap((task) => (task.issues || []).map((issue) => {
              const actionTaken = issueActionDrafts[issue.id]
                || (issue.action_taken === true ? 'yes' : issue.action_taken === false ? 'no' : '')
              return (
              <article key={issue.id} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link to={`/delivery-issues/${encodeURIComponent(issue.id)}`} className="font-semibold text-slate-900 underline">Reported delivery issue · {task.receiver_name || 'Food receiver'} · View</Link>
                    <p className="mt-1 text-xs text-slate-600">Request: {issue.request_id || task.request_id || 'Not linked'} · Delivery: {issue.delivery_id || task.id}</p>
                    <p className="mt-1 text-xs text-slate-500">Submitted: {new Date(issue.created_at).toLocaleString()}</p>
                    <p className="mt-2 text-sm text-slate-700">{issue.description}</p>
                    {issue.action_taken === true && issue.resolution_note && <p className="mt-2 text-sm text-slate-600">Action taken: {issue.resolution_note}</p>}
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusToneClass(issue.status)}`}>{formatStatus(issue.status)}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Issue status
                    <select value={issueStatusDrafts[issue.id] || issue.status} onChange={(event) => setIssueStatusDrafts((current) => ({ ...current, [issue.id]: event.target.value as DeliveryIssue['status'] }))} className="input-shell mt-1">
                      <option value={issue.status}>{formatStatus(issue.status)}</option>
                      {issue.status === 'reported' && <option value="under_review">Under Review</option>}
                      {issue.status === 'open' && <option value="under_review">Under Review</option>}
                      {issue.status === 'under_review'
                        && issue.action_taken === true
                        && actionTaken !== 'no'
                        && <option value="resolved">Resolved</option>}
                    </select>
                  </label>
                  <button type="button" onClick={() => void updateDeliveryIssueStatus(issue)} disabled={(issueStatusDrafts[issue.id] || issue.status) === issue.status} className="primary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold disabled:opacity-50"><Save size={13} />Save status</button>
                </div>
                {issue.status === 'under_review' && (
                  <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                    <label className="block text-xs font-semibold text-slate-700">
                      Was any action taken?
                      <select
                        value={actionTaken}
                        onChange={(event) => {
                          const action = event.target.value as '' | 'yes' | 'no'
                          setIssueActionDrafts((current) => ({ ...current, [issue.id]: action }))
                          if (action) setIssueStatusDrafts((current) => ({ ...current, [issue.id]: 'under_review' }))
                        }}
                        className="input-shell mt-1"
                      >
                        <option value="">Select Yes or No</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                    {actionTaken === 'yes' && (
                      <label className="block text-xs font-semibold text-slate-700">
                        What action was taken?
                        <textarea
                          value={issueActionNoteDrafts[issue.id] ?? issue.resolution_note ?? ''}
                          onChange={(event) => {
                            setIssueActionNoteDrafts((current) => ({ ...current, [issue.id]: event.target.value }))
                            if (!event.target.value.trim()) setIssueStatusDrafts((current) => ({ ...current, [issue.id]: 'under_review' }))
                          }}
                          maxLength={2000}
                          className="input-shell mt-1 min-h-20"
                          placeholder="Describe the action taken for the receiver."
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveDeliveryIssueAction(issue)}
                      disabled={
                        !actionTaken
                        || (actionTaken === 'no' && issue.action_taken === false && !issue.resolution_note)
                      }
                      className="primary-btn inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save size={13} />Save action
                    </button>
                  </div>
                )}
              </article>
              )
            }))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No delivery feedback or reported issues have been submitted yet.</p>
        )}
      </section>

      <section id="profile" className="section-shell rounded-[28px] p-5">
        <h2 className="text-2xl font-bold text-slate-900">Organization profile</h2>
        <form onSubmit={saveOrganizationProfile} className="mt-4 grid gap-4 md:grid-cols-2">
          {([
            ['full_name', 'Contact name'],
            ['organization_name', 'Organization name'],
            ['phone', 'Phone'],
            ['address', 'Address'],
            ['city', 'City'],
          ] as const).map(([field, label]) => (
            <label key={field} className="text-sm font-medium text-slate-700">
              <span className="mb-1 inline-flex items-center gap-1.5">{label === 'Contact name' ? <UserRound size={14} /> : label === 'Phone' ? <Phone size={14} /> : label === 'Address' || label === 'City' ? <MapPin size={14} /> : <Building2 size={14} />}{label}</span>
              <input value={profileForm[field]} onChange={(event) => setProfileForm((current) => ({ ...current, [field]: event.target.value }))} className="input-shell mt-2" required={field === 'full_name'} />
            </label>
          ))}
          {profileMessage && <p className="text-sm text-[#1d4d3d]" role="status">{profileMessage}</p>}
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold" disabled={savingProfile}>{savingProfile ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}{savingProfile ? 'Saving…' : 'Save organization profile'}</button>
          </div>
        </form>
      </section>

      <section id="needs" className="section-shell rounded-[28px] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Community food needs</h2>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[#edf8ef] px-2.5 py-1 text-xs font-semibold text-[#1d4d3d]">{needs.length} active</span>
            {!needFormOpen && (
              <button type="button" onClick={() => setNeedFormOpen(true)} className="primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold">
                <Plus size={16} />Create Need
              </button>
            )}
          </div>
        </div>

        {needFormOpen && (
          <form id="community-need-form" onSubmit={handleCreateNeed} className="mt-5 grid w-full max-w-5xl gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Utensils size={15} />Food Name</label>
              <input value={needFoodName} onChange={(event) => setNeedFoodName(event.target.value)} className="input-shell" placeholder="Enter a food name" required />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Package size={15} />Food Category</label>
              <select value={needForm.category} onChange={(event) => setNeedForm((current) => ({ ...current, category: event.target.value }))} className="input-shell">
                <option>Meals</option>
                <option>Snacks</option>
                <option>Fruits</option>
                <option>Vegetables</option>
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Package size={15} />Required Quantity</label>
              <input type="number" min="1" value={needForm.required_quantity} onChange={(event) => setNeedForm((current) => ({ ...current, required_quantity: event.target.value }))} className="input-shell" required />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><MapPin size={15} />Location / Delivery Location</label>
              <input value={needForm.location} onChange={(event) => setNeedForm((current) => ({ ...current, location: event.target.value }))} className="input-shell" placeholder="Shivaji Nagar" required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">City</label>
              <input value={needForm.city} onChange={(event) => setNeedForm((current) => ({ ...current, city: event.target.value }))} className="input-shell" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Urgency</label>
              <select value={needForm.urgency} onChange={(event) => setNeedForm((current) => ({ ...current, urgency: event.target.value }))} className="input-shell">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><CalendarDays size={15} />Required Date</label>
              <input type="datetime-local" value={needForm.required_date} onChange={(event) => setNeedForm((current) => ({ ...current, required_date: event.target.value }))} className="input-shell" required />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">Description</label>
              <textarea value={needForm.description} onChange={(event) => setNeedForm((current) => ({ ...current, description: event.target.value }))} className="input-shell min-h-[100px]" placeholder="Describe who needs support and any distribution details." required />
            </div>

            {message && <div className={`md:col-span-2 rounded-2xl border px-4 py-3 text-sm ${/successfully|created/i.test(message) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`} role={/successfully|created/i.test(message) ? 'status' : 'alert'}>{message}</div>}

            <div className="md:col-span-2 flex justify-end gap-3">
              <button type="button" onClick={cancelCreateNeed} className="secondary-btn inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold">
                <X size={16} />{editingNeedId ? 'Cancel edit' : 'Cancel'}
              </button>
              <button type="submit" className="primary-btn inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold">
                {editingNeedId ? <Save size={16} /> : <Plus size={16} />}{editingNeedId ? 'Save Changes' : 'Create Need'}
              </button>
            </div>
          </form>
        )}

        {needs.length ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {needs.map((need) => (
              <div key={need.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold text-slate-900">{need.category}</p>
                  <span className="rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1d4d3d]">{need.urgency}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{need.location} • {need.required_quantity} required</p>
                <p className="mt-1 text-xs text-slate-500">Status: {formatStatus(need.status)}</p>
                <p className="mt-1 text-xs text-slate-500">Delivered: {need.delivered_quantity || 0} / {need.required_quantity}</p>
                {need.contributions?.length ? (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                    <h3 className="text-sm font-bold text-slate-800">Donor responses and delivery tracking</h3>
                    {need.contributions.map((contribution) => (
                      <div key={contribution.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-800">{contribution.donor_name} · {contribution.quantity} servings</p>
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {formatStatus(contribution.delivery_status || contribution.status || 'responded')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">Pickup: {contribution.pickup_location || 'Not provided'}</p>
                        {contribution.delivery_status && (
                          <p className="mt-1 text-xs text-slate-600">
                            {contribution.volunteer_name ? `Volunteer: ${contribution.volunteer_name} · ` : ''}Delivery: {formatStatus(contribution.delivery_status)}
                          </p>
                        )}
                        {contribution.delivery_task_id && contribution.pickup_location && (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(contribution.pickup_location)}&destination=${encodeURIComponent([need.location, need.city].filter(Boolean).join(', '))}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex text-xs font-semibold text-[#1d4d3d] underline"
                          >
                            View delivery route
                          </a>
                        )}
                        {!contribution.delivery_task_id && contribution.status !== 'delivered' && (
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <label className="min-w-48 flex-1 text-xs font-semibold text-slate-700">
                              Assign available volunteer
                              <select
                                value={needVolunteerSelections[contribution.id] || ''}
                                onChange={(event) => setNeedVolunteerSelections((current) => ({ ...current, [contribution.id]: event.target.value }))}
                                className="input-shell mt-1"
                              >
                                <option value="">Select volunteer</option>
                                {availableVolunteers.map((volunteer) => (
                                  <option key={volunteer.id} value={volunteer.id}>
                                    {volunteer.full_name}{volunteer.city ? ` · ${volunteer.city}` : ''}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() => void assignNeedDelivery(need, contribution)}
                              disabled={!availableVolunteers.length || !needVolunteerSelections[contribution.id] || !contribution.pickup_location}
                              className="primary-btn px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Assign delivery
                            </button>
                            {!availableVolunteers.length && <p className="w-full text-xs text-slate-500">No available volunteers at this time.</p>}
                            {!contribution.pickup_location && <p className="w-full text-xs text-amber-700">The donor must save a pickup location before assignment.</p>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-3 text-xs text-slate-500">No donor responses yet.</p>}
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => editCommunityNeed(need)} className="secondary-btn inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold">
                      <Pencil size={14} />Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCommunityNeed(need)}
                      disabled={deletingNeedId === need.id}
                      className="secondary-btn inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={14} />{deletingNeedId === need.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No community needs yet.</div>
        )}
      </section>

    </div>
  )
}

function AdminDashboard({ overview, donations, requests, needs }: { overview: DashboardSummary | null; donations: Donation[]; requests: RequestItem[]; needs: CommunityNeed[] }) {
  const [chartCurrentMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const stats = [
    { label: 'Total users', value: overview?.stats.total_users ?? 0, accent: 'bg-[#edf8ef] text-[#1d4d3d]' },
    { label: 'Food donations', value: overview?.stats.total_donations ?? 0, accent: 'bg-[#fff4df] text-[#b45309]' },
    { label: 'Requests', value: overview?.stats.total_requests ?? 0, accent: 'bg-[#eff6ff] text-[#1d4ed8]' },
    { label: 'Needs', value: overview?.stats.active_needs ?? 0, accent: 'bg-[#fdf2f8] text-[#be185d]' },
  ]

  const chartData = useMemo(() => Array.from({ length: 5 }, (_, index) => {
    const month = new Date(chartCurrentMonth.getFullYear(), chartCurrentMonth.getMonth() - 4 + index, 1)
    const belongsToMonth = (createdAt?: string) => {
      if (!createdAt) return false
      const date = new Date(createdAt)
      return !Number.isNaN(date.getTime()) && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth()
    }
    return {
      month: month.toLocaleString(undefined, { month: 'short' }),
      donations: donations.filter((item) => belongsToMonth(item.created_at)).length,
      requests: requests.filter((item) => belongsToMonth(item.created_at)).length,
    }
  }), [chartCurrentMonth, donations, requests])
  const hasPlatformActivity = chartData.some((item) => item.donations || item.requests)

  return (
    <div id="overview" className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, accent }) => (
          <div key={label} className="metric-card section-shell rounded-[28px] p-5">
            <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>
              <ShieldCheck size={18} />
            </div>
            <p className="text-3xl font-black text-slate-900">{value}</p>
            <p className="mt-2 text-sm text-slate-600">{label}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="section-shell rounded-[28px] p-5">
          <h2 className="text-2xl font-bold text-slate-900">Platform activity</h2>
          {hasPlatformActivity ? (
            <div className="mt-5 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorDonations" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1d4d3d" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#1d4d3d" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip />
                  <Area dataKey="donations" stroke="#1d4d3d" fill="url(#colorDonations)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No platform activity yet.</p>
          )}
        </div>

      </section>

      <section id="users" className="section-shell rounded-[28px] p-5">
        <h2 className="text-2xl font-bold text-slate-900">Live platform summary</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Donations</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{donations.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Requests</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{requests.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Needs</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{needs.length}</p>
          </div>
        </div>
      </section>

      <section id="reports" className="section-shell rounded-[28px] p-5">
        <h2 className="text-2xl font-bold text-slate-900">Recent donation snapshot</h2>
        {hasPlatformActivity ? (
          <div className="mt-5 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Bar dataKey="donations" fill="#1d4d3d" radius={[8, 8, 0, 0]} />
                <Bar dataKey="requests" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No donation or request activity yet.</p>
        )}
      </section>
    </div>
  )
}

export default App

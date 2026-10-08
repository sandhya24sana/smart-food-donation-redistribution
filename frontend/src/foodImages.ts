const LOCAL_FOOD_IMAGES: Array<[RegExp, string]> = [
  [/\bchap(?:p?ati|p?athi|p?atti)s?\b|\brotis?\b|\bphulkas?\b|\bfulkas?\b|\bparathas?\b|\bparanthas?\b/, '/food-images/chapati.jpg'],
  [/\bparottas?\b|\bporottas?\b/, '/food-images/parotta.jpg'],
  [/\bbiryani\b|\bbiriyani\b|\bbriyani\b|\bbiriani\b/, '/food-images/biryani.jpg'],
  [/\bidlis?\b|\bidly\b|\bidlies\b|\bidli[\s-]?sambar\b/, '/food-images/idli.jpg'],
  [/\bdosas?\b|\bdosai\b|\bdosais\b|\bthosai\b|\bthosais\b|\bdhosai\b|\bdhosa\b|\btosai\b/, '/food-images/south-indian.jpg'],
  [/\bmomos?\b|\bmomo[\s-]?dumplings?\b/, '/food-images/momos.jpg'],
  [/\bven[\s-]?pongal\b|\bsakkarai[\s-]?pongal\b|\bsweet[\s-]?pongal\b|\bpongals?\b/, '/food-images/pongal.jpg'],
  [/\bupma\b|\buppuma\b|\buppittu\b/, '/food-images/upma.jpg'],
  [/\bpuri\b|\bpoori\b|\bpoor[iy]\b|\bsamos(?:a|as|e|ay)\b|\bpako(?:ras?|das?)\b|\bbhaji\b|\bchaat\b|\bdhokla\b|\bkachori\b|\bcutlet\b|\bvada[\s-]?pav\b|\bpav[\s-]?bhaji\b|\bfritter\b|\bnamkeen\b|\bpapad(?:um)?\b|\bsnack\b/, '/food-images/snacks.jpg'],
  [/\bsweets?\b|\bdesserts?\b|\bmithai\b|\bgulab[\s-]?jamun\b|\bgolab[\s-]?jamun\b|\bjamun\b|\brasgulla\b|\brasmalai\b|\bjalebi\b|\bladd?oo?\b|\bladdu\b|\bburfi\b|\bbarfi\b|\bhalwa\b|\bkheer\b|\bpayasam\b|\bpeda\b|\bsoan[\s-]?papdi\b|\bmishti\b/, '/food-images/sweets.jpg'],
  [/\bbakery\b|\bbread\b|\bcake\b|\bcupcake\b|\bmuffin\b|\bcroissant\b|\bpuff pastry\b|\bpuff\b|\bbun\b|\bbiscuit\b|\bcookie\b|\bbrownie\b|\bdoughnut\b|\bdonut\b|\brusk\b|\bbagel\b|\bbaguette\b|\bpastr(?:y|ies)\b/, '/food-images/bakery.jpg'],
  [/\bfast[\s-]?food\b|\bburgers?\b|\bhamburgers?\b|\bcheeseburgers?\b|\bpizzas?\b|\bfries\b|\bfrench fries\b|\bhot[\s-]?dogs?\b|\bsandwich(?:es)?\b|\btacos?\b|\bnuggets?\b|\bpasta\b|\bmac(?:aroni)?\s*(?:and|&)\s*cheese\b|\bchips\b/, '/food-images/fast-food.jpg'],
  [/\bbeverages?\b|\bdrinks?\b|\bchai\b|\btea\b|\bcoffee\b|\bkaapi\b|\bjuice\b|\bjuices\b|\blassi\b|\bbuttermilk\b|\bchaas\b|\bmilkshake\b|\bsmoothie\b|\bsoda\b|\bcola\b|\blemonade\b|\bsharbat\b|\bnimbu[\s-]?pani\b|\bwater\b/, '/food-images/beverages.jpg'],
  [/\bnon[\s-]?(?:veg(?:etarian)?|vegetarian)\b|\bmeat\b|\bchicken\b|\bmutton\b|\blamb\b|\bgoat\b|\bbeef\b|\bpork\b|\bfish\b|\bseafood\b|\bprawn\b|\bshrimp\b|\bcrab\b|\blobster\b|\bkeema\b|\banda\b|\beggs?\b|\bkebabs?\b|\bkababs?\b|\btandoori\b|\bbutter chicken\b|\bchicken tikka\b|\bfried chicken\b/, '/food-images/non-vegetarian.jpg'],
  [/\brolls?\b|\bwraps?\b|\bkathi\b|\bshawarma\b|\bburrito\b|\bfrankie\b|\bquesadilla\b/, '/food-images/rolls-wraps.jpg'],
  [/\bfruits?\b|\bmango(?:es)?\b|\bbanana(?:s)?\b|\bapples?\b|\bberries\b|\bstrawberr(?:y|ies)\b|\bblueberr(?:y|ies)\b|\boranges?\b|\bgrapes?\b|\bpapaya\b|\bguava\b|\bpomegranate\b|\bwatermelon\b|\bmelon\b|\bpear\b|\bpineapple\b|\bchikoo\b|\bsapota\b|\bjackfruit\b|\bkiwi\b|\bpeach\b|\bplum\b/, '/food-images/fruits.jpg'],
  [/\bvegetables?\b|\bveggies\b|\bsalad\b|\bsabzi\b|\bgreens\b|\bproduce\b|\bspinach\b|\bpotatoes?\b|\btomatoes?\b|\bcarrots?\b|\bonions?\b|\bpeas\b|\bcauliflower\b|\bcabbage\b|\bokra\b|\bbhindi\b|\bbrinjal\b|\beggplant\b|\baubergine\b|\bbroccoli\b|\bcucumber\b|\bbeans\b|\bpumpkin\b|\bbell peppers?\b|\bcapsicum\b/, '/food-images/vegetables.jpg'],
  [/\bnorth[\s-]?indian\b|\bveg(?:etarian)?[\s-]?(?:meal|food|dish)\b|\bvegetarian\b|\bvegan\b|\bpaneer\b|\bchole\b|\bchana masala\b|\brajma\b|\bnaan\b|\bkulcha\b|\bdal\b|\bdhal\b|\blentils?\b|\bcurr(?:y|ies)\b|\bsabzi\b|\baloo\b|\bgobi\b|\bpalak\b|\bsaag\b|\bthali\b/, '/food-images/curries.jpg'],
  [/\brice\b|\bkhichdi\b|\bpulao\b|\bpulav\b|\bpilaf\b|\bmeals?\b|\blunch\b|\bdinner\b/, '/food-images/rice-meals.jpg'],
]

const LOCAL_FOOD_CATEGORY_IMAGES: Array<[RegExp, string]> = [
  [/\bmeals?\b/, '/food-images/rice-meals.jpg'],
  [/\bsouth[\s-]?indian\b|\btiffin\b/, '/food-images/south-indian.jpg'],
  [/\bsnacks?\b|\bstreet[\s-]?food\b/, '/food-images/snacks.jpg'],
  [/\bfruit\b|\bfruits\b/, '/food-images/fruits.jpg'],
  [/\bvegetables?\b|\bproduce\b/, '/food-images/vegetables.jpg'],
  [/\bcurr(?:y|ies)\b/, '/food-images/curries.jpg'],
  [/\brice\b/, '/food-images/rice-meals.jpg'],
  [/\bnon[\s-]?(?:veg(?:etarian)?|vegetarian)\b|\bmeat\b/, '/food-images/non-vegetarian.jpg'],
  [/\bbakery\b|\bbaked\b/, '/food-images/bakery.jpg'],
  [/\bfast[\s-]?food\b/, '/food-images/fast-food.jpg'],
  [/\bbeverages?\b|\bdrinks?\b/, '/food-images/beverages.jpg'],
  [/\bsweet(?:s)?\b|\bdessert(?:s)?\b/, '/food-images/sweets.jpg'],
]

export function getLocalFoodFallbackImage(foodName: string, category = ''): string {
  const normalizedName = foodName.toLocaleLowerCase().trim()
  const exactFoodImage = LOCAL_FOOD_IMAGES.find(([pattern]) => pattern.test(normalizedName))?.[1]
  if (exactFoodImage) return exactFoodImage

  const normalizedCategory = category.toLocaleLowerCase().trim()
  return LOCAL_FOOD_CATEGORY_IMAGES.find(([pattern]) => pattern.test(normalizedCategory))?.[1] || ''
}

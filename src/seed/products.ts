// Seed catalogue transcribed from the Pizza Mania product sheet.
// Units are sensible defaults per category; edit freely in the app afterwards.

interface Group {
  category: string
  prefix: string
  unit: string
  unitType: string
  names: string[]
}

const GROUPS: Group[] = [
  {
    category: 'Veggie',
    prefix: 'VEG',
    unit: 'Kilogram',
    unitType: 'KG',
    names: [
      'SWISS BROWN MUSHROOMS', 'CAPSICUM GREEN', 'CAPSICUM RED', 'CAPSICUM YELLOW',
      'THE CHILLI', 'DRIED CHILLI', 'ROCKET SALAD', 'BABY SPINACH 1.5 kg', 'BASIL',
      'LARGE TOMATO', 'CHERRY TOMATO', 'ONIONS', 'RED ONION', 'GREEN OAK SALAD',
      'RED OAK SALAD', 'COS SALAD', 'CELERY', 'GARLIC', 'EGGPLANT', 'PARSLEY',
      'CARROTS', 'CUCUMBER', 'ZUCHINI',
    ],
  },
  {
    category: 'Meat & Seafood',
    prefix: 'MEA',
    unit: 'Kilogram',
    unitType: 'KG',
    names: [
      'ANCHOVIES 720GR NEW', 'CHICKEN BREAST', 'CHICKEN MIDDLE WING', 'CHICKEN WING น่องไก่',
      'SAUSAGE MIX DOLCE', 'SALAMI PICCANTE', 'PARMA HAM 6-7 KG 1 ลัง/2 ขา',
      'PRAMA HAM 18 MONTH (8KG/PC)', 'PEPPERONI MARGHERITA BRAND1850 IB 6KG',
      'PEPPERONI ROSA BRAND 2.27 kg', 'MUSSELS "L" 12X1KG', 'SMOKED BACON SLICED 1 KG',
      'BEEF MEAT BALL 1KG', 'SMOKED SALMON', 'PARIS HAM', 'BEEF FROZEN 1 KG', 'EGGS',
      'PORK', 'BEEF', 'SHRIMP', 'SQUID',
    ],
  },
  {
    category: 'Cheese & Dairy',
    prefix: 'CHE',
    unit: 'Kilogram',
    unitType: 'KG',
    names: [
      'MOZZARELLA WHOLE MILK 2.72 kg*8', 'GOAT CHEESE 1 KG', 'CHEDDAR LOAF YELLOW 2.27 kg',
      'RICOTTA 250 GR', 'RICOTTA 1.5 KG', 'MASCARPONE CREAM CHEESE 6X500GR',
      'GORGONZOLA 1/8 1 kg', 'PARMESAN CHEESE', 'BLUE CHEESE 3 KG', 'FETA CHEESE 500G',
      'BOCCONCINI 100G', 'BUTTER', 'SCAMORZA', 'WHIPPING CREAM 1L', 'BUTTER MILK',
    ],
  },
  {
    category: 'Cooking Oil',
    prefix: 'OIL',
    unit: 'ขวด/แกลลอน',
    unitType: 'EA',
    names: [
      'POMACE OIL SANSA COPPINI 5LT', 'MORAKOT PALM 13.75 LT',
      'SUNFLOWER OIL COOK 1000CC 1*12', 'EXTRA VIRGIN OIL & SANSA 5 LT',
    ],
  },
  {
    category: 'Seasoning',
    prefix: 'SEA',
    unit: 'หน่วย',
    unitType: 'EA',
    names: [
      'SEA SALT 1 KG', 'SALT 1 KGX24', 'WHITE WINE 2L', 'RED WINE 2L', 'SOUR CREAM',
      'BROWN SUGAR 500GX40', 'PURE SUGAR 1 KG 1 Pack/25Pc', 'AROMAT 1Box/6Pc',
      'TABASCO PEPPER 2 OZ 1X12', 'MAYONNAISE 1KG', 'PEPPER BLACK 500G', 'OREGANO 500G',
      'DRIED CHILI', 'YEAST', 'RED WINE VINEGAR', 'WORCESTERSHIRE SAUCE LEA & PERRINS',
      'BAKING SODA', 'LIME MIXED', 'MUSTARD', 'VODKA', 'SRIRACHA', 'THAI DANCER SRIRACHA',
      'ONION POWDER', 'GARLIC POWDER', 'MUSTARD POWDER', 'HONEY',
    ],
  },
  {
    category: 'Flour',
    prefix: 'FLR',
    unit: 'ถุง',
    unitType: 'EA',
    names: [
      'FLOUR DANG 22.5KG', 'FLOUR FRESH 22.5 kg', 'FLOUR FAH 25KG', 'FLOUR VENUS 22.5 kg',
      'NATURKRAFT FLOUR 10 KG', 'BARLAY MALT',
    ],
  },
  {
    category: 'Pasta',
    prefix: 'PAS',
    unit: 'หน่วย',
    unitType: 'EA',
    names: ['FUSILLI 500 G', 'PENNE 500 G', 'SPAGHETTI 500 G'],
  },
  {
    category: 'Canned Goods',
    prefix: 'CAN',
    unit: 'หน่วย',
    unitType: 'EA',
    names: [
      'PINEAPPLE SLICE IN SYRUP DOLE 567G', 'PITTED BLACK OLIVES',
      'PITTED KALAMATA OLIVE IN BRINE 5kg', 'GREEK PEPERONCINI 12x16 OZ',
      'SWEET BANANA WAX 16OZX6', 'ARTICHOKE ORTOCONSERV 2400gr', 'JALAPENO 2.8kg',
      'CAPPER', 'WALNUT 500 G', 'CRANBERRY', 'FIG JAM 65% 340G',
    ],
  },
  {
    category: 'Pizza Sauce',
    prefix: 'SAU',
    unit: 'หน่วย',
    unitType: 'EA',
    names: [
      'TOMATO SAUCE 4.10KG', 'BBQ SAUCE', 'BALSAMIC COLAVITA 2X5 LT',
      'SUNDRY TOMATO BAG 1KG', 'MICA TOMATO', 'FRANK RED HOT 3.78 LT 1 ลัง/4 แกลลอน',
      'RANCH', 'SAMYANG SPICY SAUCE 1ลัง/6ถุง',
    ],
  },
  {
    category: 'Fries',
    prefix: 'FRY',
    unit: 'หน่วย',
    unitType: 'EA',
    names: ['FRENCH FRIES 3/8 2.26KG', 'CURLEY FRIES 2.267KG', 'NUGGET 1box*12Pack 1kg/Pack'],
  },
  {
    category: 'Pizza Packing & Other',
    prefix: 'PKG',
    unit: 'หน่วย',
    unitType: 'EA',
    names: [
      'PIZZA BOX 13" 1PACK=50PCS', 'PIZZA BOX 18.5" 1PACK=25PCS', 'SAUCE CUP NO 1 600/Box',
      'SAUCE CUP 30ML 50Pcs/1Pack', 'SAUCE CUP 2 OZ. 1 Box=1000 Pc',
      'SAUCE CUP 1 OZ. 1 Box=1000 Pc', 'SALAD BOX PC-1300ML+Cover (25*12) 1 ลัง/300 ชิ้น',
      'OIL BOTTLE ขวดแก้ว', 'CHICKEN WINGS BOX', 'CHICKEN WINGS BOX 1 Box=400 Pc',
      'SNACK BAG SOS GR50 KIT6', 'PLASTIC BAG 9X18', 'PLASTIC BAG 12X20', 'PLASTIC BAG 8X16',
      'ZIP LOCK BAG 8X12', 'PLASTIC BAG 18*36', 'PP BAG 6X9', 'TISSUE PAPER 1 BOX/20PCS',
      'PIZZA BOX PUSHER ขาดันกล่อง', 'BOX PASTA PC-750 ML+COVER (25*12) 1 ลัง/300 ชิ้น',
      'PAPER PLATE 1Pack/50Pcs', 'STICKER-DIE-CUT', 'TOMATO KETCHUP PACKAGE 10G 3X100',
      'OREGANO 0.3G 1X2500', 'CAYENNE PEPPER 1X2500',
    ],
  },
  {
    category: 'Beverage',
    prefix: 'BEV',
    unit: 'แพ็ค',
    unitType: 'Pack',
    names: [
      'COKE 1.25 L 1x12', 'COKE CAN 325 ML 1X24', 'COKE LIGHT CAN 325 ML 1X24',
      'COKE ZERO CAN 325 ML 1X24',
    ],
  },
]

export interface SeedProduct {
  sku: string
  name: string
  category: string
  unit: string
  unitType: string
  minStock: number
}

export const SEED_PRODUCTS: SeedProduct[] = GROUPS.flatMap((g) =>
  g.names.map((name, i) => ({
    sku: `${g.prefix}-${String(i + 1).padStart(3, '0')}`,
    name,
    category: g.category,
    unit: g.unit,
    unitType: g.unitType,
    minStock: 0,
  })),
)

export const SEED_CATEGORIES: string[] = GROUPS.map((g) => g.category)

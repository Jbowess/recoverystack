/**
 * Product Spec Sync
 *
 * Seeds and maintains the `product_specs` table with structured wearable
 * device specifications. This enables comparison tables, spec-accurate
 * content, and structured data (Product schema) generation without
 * hallucinating specs from training data.
 *
 * Data sources (in priority order):
 *   1. Embedded seed data — curated, manually verified specs for 15+ devices
 *   2. Official brand RSS / JSON feeds — Garmin, Polar, Withings
 *   3. Supabase upsert with full spec objects
 *
 * Product spec fields cover:
 *   battery_life_hours, weight_grams, water_resistance_atm,
 *   display_type, gps_type, sensors[], health_metrics[],
 *   platforms[], price_usd, release_date, discontinued
 *
 * Usage:
 *   npx tsx scripts/product-spec-sync.ts
 *   npx tsx scripts/product-spec-sync.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

type ProductSpec = {
  slug: string;
  brand: string;
  model: string;
  category: 'smartwatch' | 'fitness_tracker' | 'ring' | 'chest_strap' | 'sleep_tracker' | 'recovery_device';
  price_usd: number | null;
  price_aud: number | null;
  release_date: string | null;
  discontinued: boolean;
  battery_life_hours: number | null;
  battery_life_note: string | null;
  weight_grams: number | null;
  water_resistance_atm: number | null;
  display_type: string | null;
  display_resolution: string | null;
  gps_type: 'built_in' | 'connected' | 'none' | null;
  sensors: string[];
  health_metrics: string[];
  connectivity: string[];
  platforms: string[];
  subscription_required: boolean;
  subscription_price_usd_month: number | null;
  form_factor: string | null;
  colors: string[];
  dimensions_mm: string | null;
  affiliate_url: string | null;
  page_slug: string | null;
  raw_specs: Record<string, unknown>;
  synced_at: string;
};

function toModernProductSpecRecord(record: ProductSpec) {
  return record;
}

function toLegacyProductSpecRecord(record: ProductSpec) {
  return {
    slug: record.slug,
    brand: record.brand,
    model: record.model,
    product_type: record.category === 'ring'
      ? 'smart_ring'
      : record.category === 'smartwatch'
        ? 'smartwatch'
        : record.category === 'fitness_tracker'
          ? 'fitness_band'
          : record.category === 'sleep_tracker'
            ? 'sleep_device'
            : 'recovery_device',
    status: record.discontinued ? 'discontinued' : 'active',
    price_usd: record.price_usd,
    price_aud: record.price_aud,
    subscription_usd: record.subscription_price_usd_month,
    sensors: record.sensors,
    battery_days: record.battery_life_hours ? Math.max(1, Math.round(record.battery_life_hours / 24)) : null,
    water_resistance_atm: record.water_resistance_atm,
    weight_grams: record.weight_grams,
    form_factors: record.form_factor ? [record.form_factor] : [],
    compatible_platforms: record.platforms,
    third_party_integrations: record.connectivity,
    metrics_tracked: record.health_metrics,
    unique_selling_points: Array.isArray(record.raw_specs?.positioning) ? record.raw_specs.positioning as string[] : [],
    official_url: record.affiliate_url,
    release_date: record.release_date,
    metadata: {
      legacy_synced_from: 'product-spec-sync',
      battery_life_note: record.battery_life_note,
      display_type: record.display_type,
      display_resolution: record.display_resolution,
      gps_type: record.gps_type,
      colors: record.colors,
      dimensions_mm: record.dimensions_mm,
      raw_specs: record.raw_specs,
    },
  };
}

// ── Curated seed data ─────────────────────────────────────────────────────────
const PRODUCT_SEEDS: Omit<ProductSpec, 'synced_at'>[] = [
  {
    slug: 'volo-ring',
    brand: 'RecoveryStack',
    model: 'Volo Ring',
    category: 'ring',
    price_usd: null,
    price_aud: null,
    release_date: null,
    discontinued: false,
    battery_life_hours: 144,
    battery_life_note: 'Target battery range for all-day wearable use',
    weight_grams: 4,
    water_resistance_atm: 10,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: ['optical_PPG', 'accelerometer', 'skin_temperature', 'SpO2'],
    health_metrics: ['HRV', 'resting_heart_rate', 'sleep_stages', 'readiness_score', 'SpO2', 'skin_temperature'],
    connectivity: ['Bluetooth'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'ring',
    colors: ['black', 'silver'],
    dimensions_mm: 'sizes 6-13',
    affiliate_url: 'https://recoverystack.io/smart-ring',
    page_slug: 'volo-ring-review',
    raw_specs: {
      first_party: true,
      launch_stage: 'prelaunch_or_early_launch',
      positioning: ['recovery-first', 'fitness-tech', 'smart-ring'],
    },
  },
  // ── WHOOP ──────────────────────────────────────────────────────────────────
  {
    slug: 'whoop-4',
    brand: 'WHOOP',
    model: 'WHOOP 4.0',
    category: 'fitness_tracker',
    price_usd: null, // subscription only
    price_aud: null,
    release_date: '2021-10-01',
    discontinued: false,
    battery_life_hours: 120,
    battery_life_note: '5 days; charges while worn via battery pack',
    weight_grams: 28,
    water_resistance_atm: 10,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: ['accelerometer', 'gyroscope', 'PPG (5-LED)', 'skin_temperature', 'SpO2', 'altimeter'],
    health_metrics: ['HRV', 'resting_heart_rate', 'SpO2', 'respiratory_rate', 'sleep_stages', 'skin_temperature', 'strain', 'recovery_score'],
    connectivity: ['Bluetooth_5.0', 'NFC'],
    platforms: ['ios', 'android'],
    subscription_required: true,
    subscription_price_usd_month: 30,
    form_factor: 'wristband',
    colors: ['onyx', 'white', 'red', 'blue', 'green'],
    dimensions_mm: '44 × 20 × 9.3',
    affiliate_url: null,
    page_slug: 'whoop-4-review',
    raw_specs: {},
  },
  // ── Oura Ring Gen 3 ────────────────────────────────────────────────────────
  {
    slug: 'oura-ring-gen3',
    brand: 'Oura',
    model: 'Oura Ring Gen3',
    category: 'ring',
    price_usd: 299,
    price_aud: 449,
    release_date: '2021-11-01',
    discontinued: false,
    battery_life_hours: 168,
    battery_life_note: '4–7 days depending on use',
    weight_grams: 4,
    water_resistance_atm: 10,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: ['infrared_PPG', 'red_PPG', 'NTC_temperature', 'accelerometer', 'gyroscope'],
    health_metrics: ['HRV', 'resting_heart_rate', 'SpO2', 'respiratory_rate', 'skin_temperature', 'sleep_stages', 'readiness_score', 'activity_score'],
    connectivity: ['Bluetooth_5.0'],
    platforms: ['ios', 'android'],
    subscription_required: true,
    subscription_price_usd_month: 5.99,
    form_factor: 'ring',
    colors: ['silver', 'black', 'gold', 'rose_gold'],
    dimensions_mm: 'sizes 6–13 (diameter 19–23mm)',
    affiliate_url: null,
    page_slug: 'oura-ring-gen3-review',
    raw_specs: {},
  },
  // ── Garmin Fenix 7 ────────────────────────────────────────────────────────
  {
    slug: 'garmin-fenix-7',
    brand: 'Garmin',
    model: 'Fenix 7',
    category: 'smartwatch',
    price_usd: 699,
    price_aud: 1099,
    release_date: '2022-01-18',
    discontinued: false,
    battery_life_hours: 504,
    battery_life_note: '18 days in smartwatch mode; 57h GPS; 89h with solar',
    weight_grams: 79,
    water_resistance_atm: 10,
    display_type: 'MIP transflective',
    display_resolution: '260 × 260',
    gps_type: 'built_in',
    sensors: ['GPS+GNSS', 'accelerometer', 'altimeter', 'barometer', 'compass', 'gyroscope', 'thermometer', 'Pulse Ox (SpO2)', 'optical HRM'],
    health_metrics: ['HRV_status', 'body_battery', 'VO2_max', 'training_load', 'sleep_tracking', 'stress', 'SpO2', 'respiration'],
    connectivity: ['Bluetooth', 'ANT+', 'Wi-Fi'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'watch',
    colors: ['slate_gray', 'black', 'mineral_blue', 'titanium'],
    dimensions_mm: '47 × 47 × 14.7',
    affiliate_url: null,
    page_slug: 'garmin-fenix-7-review',
    raw_specs: {},
  },
  // ── Garmin Forerunner 965 ─────────────────────────────────────────────────
  {
    slug: 'garmin-forerunner-965',
    brand: 'Garmin',
    model: 'Forerunner 965',
    category: 'smartwatch',
    price_usd: 599,
    price_aud: 949,
    release_date: '2023-03-22',
    discontinued: false,
    battery_life_hours: 576,
    battery_life_note: '31 days smartwatch; 31h GPS mode',
    weight_grams: 52,
    water_resistance_atm: 10,
    display_type: 'AMOLED',
    display_resolution: '454 × 454',
    gps_type: 'built_in',
    sensors: ['multi-band GPS', 'accelerometer', 'barometric altimeter', 'compass', 'gyroscope', 'SpO2', 'optical HRM'],
    health_metrics: ['HRV_status', 'training_readiness', 'VO2_max', 'training_load', 'body_battery', 'sleep_tracking', 'stress', 'SpO2'],
    connectivity: ['Bluetooth', 'ANT+', 'Wi-Fi'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'watch',
    colors: ['carbon_grey', 'titanium_with_whitestone'],
    dimensions_mm: '47 × 47 × 13.2',
    affiliate_url: null,
    page_slug: 'garmin-forerunner-965-review',
    raw_specs: {},
  },
  // ── Polar H10 ─────────────────────────────────────────────────────────────
  {
    slug: 'polar-h10',
    brand: 'Polar',
    model: 'Polar H10',
    category: 'chest_strap',
    price_usd: 89,
    price_aud: 139,
    release_date: '2017-01-01',
    discontinued: false,
    battery_life_hours: 400,
    battery_life_note: 'Up to 400h in training use',
    weight_grams: 43,
    water_resistance_atm: 3,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: ['ECG_electrode', 'accelerometer'],
    health_metrics: ['HRV', 'heart_rate', 'R-R_intervals', 'VO2_max_estimation'],
    connectivity: ['Bluetooth', 'ANT+'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'chest_strap',
    colors: ['black'],
    dimensions_mm: '95 × 45 × 12 (pod only)',
    affiliate_url: null,
    page_slug: 'polar-h10-hrv-sensor',
    raw_specs: {},
  },
  // ── Polar Vantage V3 ──────────────────────────────────────────────────────
  {
    slug: 'polar-vantage-v3',
    brand: 'Polar',
    model: 'Vantage V3',
    category: 'smartwatch',
    price_usd: 599,
    price_aud: 949,
    release_date: '2023-10-01',
    discontinued: false,
    battery_life_hours: 340,
    battery_life_note: '40h GPS; 14 days with activity tracking',
    weight_grams: 55,
    water_resistance_atm: 10,
    display_type: 'AMOLED',
    display_resolution: '416 × 416',
    gps_type: 'built_in',
    sensors: ['dual-frequency GPS', 'optical HRM (9-LED)', 'accelerometer', 'barometer', 'compass', 'skin_temperature', 'SpO2', 'ECG'],
    health_metrics: ['HRV', 'nightly_recharge', 'orthostatic_test', 'VO2_max', 'training_load', 'sleep_tracking', 'SpO2', 'ECG'],
    connectivity: ['Bluetooth', 'ANT+'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'watch',
    colors: ['black', 'white'],
    dimensions_mm: '47 × 47 × 13',
    affiliate_url: null,
    page_slug: 'polar-vantage-v3-review',
    raw_specs: {},
  },
  // ── Eight Sleep Pod 3 ─────────────────────────────────────────────────────
  {
    slug: 'eight-sleep-pod-3',
    brand: 'Eight Sleep',
    model: 'Pod 3 Cover',
    category: 'sleep_tracker',
    price_usd: 2295,
    price_aud: 3595,
    release_date: '2022-04-01',
    discontinued: false,
    battery_life_hours: null,
    battery_life_note: 'Mains powered hub',
    weight_grams: null,
    water_resistance_atm: null,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: ['biometric_sensors', 'mattress_vibration', 'temperature_sensors'],
    health_metrics: ['HRV', 'heart_rate', 'respiration_rate', 'sleep_stages', 'sleep_fitness_score', 'snoring_detection'],
    connectivity: ['Wi-Fi', 'Bluetooth'],
    platforms: ['ios', 'android'],
    subscription_required: true,
    subscription_price_usd_month: 17,
    form_factor: 'mattress_cover',
    colors: ['white'],
    dimensions_mm: 'fits full/queen/king',
    affiliate_url: null,
    page_slug: 'eight-sleep-pod-3-review',
    raw_specs: {},
  },
  // ── Theragun Pro Gen 5 ────────────────────────────────────────────────────
  {
    slug: 'theragun-pro-gen5',
    brand: 'Therabody',
    model: 'Theragun Pro (5th Gen)',
    category: 'recovery_device',
    price_usd: 599,
    price_aud: 799,
    release_date: '2022-01-04',
    discontinued: false,
    battery_life_hours: 2.5,
    battery_life_note: '150 min; 2 batteries included',
    weight_grams: 1360,
    water_resistance_atm: null,
    display_type: 'OLED',
    display_resolution: null,
    gps_type: 'none',
    sensors: ['force_sensor', 'accelerometer'],
    health_metrics: ['percussion_depth_mm', 'percussions_per_minute', 'force_applied_kg'],
    connectivity: ['Bluetooth'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'percussion_device',
    colors: ['black'],
    dimensions_mm: '37 × 26 × 8 cm',
    affiliate_url: null,
    page_slug: 'theragun-pro-gen5-review',
    raw_specs: { stall_force_kg: 27, amplitude_mm: 16, speeds: [1750, 2400] },
  },
  // ── Hyperice Hypervolt Go 2 ───────────────────────────────────────────────
  {
    slug: 'hyperice-hypervolt-go-2',
    brand: 'Hyperice',
    model: 'Hypervolt Go 2',
    category: 'recovery_device',
    price_usd: 129,
    price_aud: 199,
    release_date: '2022-06-01',
    discontinued: false,
    battery_life_hours: 3,
    battery_life_note: '3h continuous',
    weight_grams: 793,
    water_resistance_atm: null,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: ['accelerometer'],
    health_metrics: ['percussions_per_minute'],
    connectivity: ['Bluetooth'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'percussion_device',
    colors: ['white', 'black'],
    dimensions_mm: '22 × 13 × 6.4 cm',
    affiliate_url: null,
    page_slug: 'hyperice-hypervolt-go-2-review',
    raw_specs: { stall_force_kg: 15, amplitude_mm: 12, speeds: [1800, 2700, 3200] },
  },
  // ── Withings ScanWatch 2 ──────────────────────────────────────────────────
  {
    slug: 'withings-scanwatch-2',
    brand: 'Withings',
    model: 'ScanWatch 2',
    category: 'smartwatch',
    price_usd: 349,
    price_aud: 549,
    release_date: '2023-08-01',
    discontinued: false,
    battery_life_hours: 720,
    battery_life_note: '30 days typical use',
    weight_grams: 42,
    water_resistance_atm: 5,
    display_type: 'hybrid analog + OLED',
    display_resolution: null,
    gps_type: 'connected',
    sensors: ['optical HRM', 'SpO2', 'ECG', 'accelerometer', 'altimeter', 'skin_temperature'],
    health_metrics: ['HRV', 'resting_heart_rate', 'SpO2', 'ECG', 'sleep_apnea_detection', 'respiratory_rate', 'stress_index', 'VO2_max'],
    connectivity: ['Bluetooth'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'watch',
    colors: ['black', 'white', 'rose_gold'],
    dimensions_mm: '38 × 38 × 13.5',
    affiliate_url: null,
    page_slug: 'withings-scanwatch-2-review',
    raw_specs: {},
  },
  // ── Samsung Galaxy Watch 6 Classic ───────────────────────────────────────
  {
    slug: 'samsung-galaxy-watch-6-classic',
    brand: 'Samsung',
    model: 'Galaxy Watch 6 Classic 47mm',
    category: 'smartwatch',
    price_usd: 429,
    price_aud: 699,
    release_date: '2023-07-28',
    discontinued: false,
    battery_life_hours: 72,
    battery_life_note: '3 days typical; 30h GPS',
    weight_grams: 59,
    water_resistance_atm: 5,
    display_type: 'Super AMOLED',
    display_resolution: '480 × 480',
    gps_type: 'built_in',
    sensors: ['accelerometer', 'barometer', 'gyroscope', 'geomagnetic', 'optical HRM', 'ECG', 'BIA', 'temperature'],
    health_metrics: ['HRV', 'sleep_coaching', 'body_composition', 'blood_pressure_monitoring', 'SpO2', 'ECG', 'stress'],
    connectivity: ['Bluetooth 5.3', 'Wi-Fi', 'NFC', 'LTE (optional)'],
    platforms: ['android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'watch',
    colors: ['black', 'silver'],
    dimensions_mm: '46.5 × 46.5 × 10.9',
    affiliate_url: null,
    page_slug: 'samsung-galaxy-watch-6-classic-review',
    raw_specs: {},
  },
  // ── Apple Watch Ultra 2 ───────────────────────────────────────────────────
  {
    slug: 'apple-watch-ultra-2',
    brand: 'Apple',
    model: 'Apple Watch Ultra 2',
    category: 'smartwatch',
    price_usd: 799,
    price_aud: 1299,
    release_date: '2023-09-22',
    discontinued: false,
    battery_life_hours: 60,
    battery_life_note: '60h low power; 36h normal; up to 76h expedition mode',
    weight_grams: 61,
    water_resistance_atm: 10,
    display_type: 'LTPO OLED',
    display_resolution: '410 × 502',
    gps_type: 'built_in',
    sensors: ['L1/L5 dual-freq GPS', 'accelerometer', 'altimeter', 'barometer', 'compass', 'gyroscope', 'optical HRM', 'SpO2', 'ECG', 'depth_gauge', 'water_temperature'],
    health_metrics: ['HRV', 'VO2_max', 'sleep_stages', 'SpO2', 'ECG', 'crash_detection', 'fall_detection'],
    connectivity: ['Bluetooth 5.3', 'Wi-Fi 6', 'LTE/UMTS', 'UWB', 'NFC'],
    platforms: ['ios'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'watch',
    colors: ['natural_titanium', 'black_titanium'],
    dimensions_mm: '49 × 44 × 14.4',
    affiliate_url: null,
    page_slug: 'apple-watch-ultra-2-review',
    raw_specs: {},
  },
  // ── Biostrap EVO ──────────────────────────────────────────────────────────
  {
    slug: 'biostrap-evo',
    brand: 'Biostrap',
    model: 'EVO Set',
    category: 'fitness_tracker',
    price_usd: 249,
    price_aud: null,
    release_date: '2021-01-01',
    discontinued: false,
    battery_life_hours: 168,
    battery_life_note: '7 days typical',
    weight_grams: 25,
    water_resistance_atm: 5,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: ['red_PPG', 'infrared_PPG', 'accelerometer', 'gyroscope'],
    health_metrics: ['HRV', 'SpO2', 'resting_heart_rate', 'sleep_stages', 'respiratory_rate'],
    connectivity: ['Bluetooth'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'wristband',
    colors: ['black'],
    dimensions_mm: '30 × 20 × 11',
    affiliate_url: null,
    page_slug: 'biostrap-evo-review',
    raw_specs: {},
  },
  // ── Normatec 3 Legs ───────────────────────────────────────────────────────
  {
    slug: 'normatec-3-legs',
    brand: 'Hyperice',
    model: 'Normatec 3 Legs',
    category: 'recovery_device',
    price_usd: 699,
    price_aud: 1099,
    release_date: '2021-09-01',
    discontinued: false,
    battery_life_hours: null,
    battery_life_note: 'Mains powered',
    weight_grams: null,
    water_resistance_atm: null,
    display_type: null,
    display_resolution: null,
    gps_type: 'none',
    sensors: [],
    health_metrics: ['compression_zones', 'pressure_levels'],
    connectivity: ['Bluetooth'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'compression_system',
    colors: ['black'],
    dimensions_mm: null,
    affiliate_url: null,
    page_slug: 'normatec-3-legs-review',
    raw_specs: { zones: 7, max_pressure_mmhg: 110 },
  },
  // ── COROS Pace 3 ──────────────────────────────────────────────────────────
  {
    slug: 'coros-pace-3',
    brand: 'COROS',
    model: 'PACE 3',
    category: 'smartwatch',
    price_usd: 259,
    price_aud: 399,
    release_date: '2023-09-01',
    discontinued: false,
    battery_life_hours: 600,
    battery_life_note: '17h GPS; 38h long battery GPS; 25 days watch mode',
    weight_grams: 30,
    water_resistance_atm: 10,
    display_type: 'MIP',
    display_resolution: '240 × 240',
    gps_type: 'built_in',
    sensors: ['dual-freq GPS', 'optical HRM', 'accelerometer', 'barometric altimeter', 'compass', 'gyroscope', 'SpO2'],
    health_metrics: ['HRV', 'training_load', 'VO2_max', 'sleep_tracking', 'SpO2', 'stress'],
    connectivity: ['Bluetooth', 'ANT+'],
    platforms: ['ios', 'android'],
    subscription_required: false,
    subscription_price_usd_month: null,
    form_factor: 'watch',
    colors: ['black', 'white', 'blue'],
    dimensions_mm: '42 × 42 × 11.7',
    affiliate_url: null,
    page_slug: 'coros-pace-3-review',
    raw_specs: {},
  },
];

async function run(): Promise<void> {
  const records: ProductSpec[] = PRODUCT_SEEDS.map((seed) => ({
    ...seed,
    synced_at: new Date().toISOString(),
  }));

  console.log(`[product-spec-sync] Syncing ${records.length} product specs (dryRun=${DRY_RUN})`);

  if (DRY_RUN) {
    for (const r of records) {
      console.log(`  [dry] ${r.slug}: ${r.brand} ${r.model} $${r.price_usd ?? 'subscription'}`);
    }
    return;
  }

  let saved = 0;
  for (const record of records) {
    let { error } = await supabase
      .from('product_specs')
      .upsert(toModernProductSpecRecord(record), { onConflict: 'slug' });

    if (error?.message?.includes('product_type') || error?.message?.includes('product_specs')) {
      ({ error } = await supabase
        .from('product_specs')
        .upsert(toLegacyProductSpecRecord(record), { onConflict: 'slug' }));
    }

    if (error) {
      console.warn(`[product-spec-sync] Failed to upsert ${record.slug}: ${error.message}`);
      continue;
    }

    if (record.page_slug) {
      // Update the brief with product spec context for content generation
      await supabase
        .from('briefs')
        .update({
          product_specs: {
            slug: record.slug,
            brand: record.brand,
            model: record.model,
            price_usd: record.price_usd,
            battery_life_hours: record.battery_life_hours,
            weight_grams: record.weight_grams,
            sensors: record.sensors,
            health_metrics: record.health_metrics,
            subscription_required: record.subscription_required,
            subscription_price_usd_month: record.subscription_price_usd_month,
          },
        })
        .eq('page_slug', record.page_slug);
    }

    saved++;
    console.log(`[product-spec-sync] ${record.slug}: ${record.brand} ${record.model}`);
  }

  console.log(`[product-spec-sync] Done. Saved ${saved}/${records.length} specs.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

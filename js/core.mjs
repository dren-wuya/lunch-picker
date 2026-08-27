export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  scope: "primary",
  cooldown_meals: 2,
  cooldown_weight: 0
});

const VALID_SCOPES = new Set(["primary", "secondary", "all"]);
const VALID_RESTAURANT_SCOPES = new Set(["primary", "secondary"]);
const VALID_RECORD_STATUSES = new Set(["restaurant", "skipped"]);
const VALID_RECORD_SOURCES = new Set(["random", "manual", "company"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parts = value.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12);
  return date.getFullYear() === parts[0]
    && date.getMonth() === parts[1] - 1
    && date.getDate() === parts[2];
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return [year, month, day].join("-");
}

export function isWeekday(dateKey) {
  assert(isValidDateKey(dateKey), "日期必须使用 YYYY-MM-DD 格式。");
  const parts = dateKey.split("-").map(Number);
  const weekday = new Date(parts[0], parts[1] - 1, parts[2], 12).getDay();
  return weekday !== 0 && weekday !== 6;
}

function validateRestaurant(restaurant, index) {
  const prefix = "第 " + (index + 1) + " 家餐厅";
  assert(isObject(restaurant), prefix + "必须是对象。");
  assert(isNonEmptyString(restaurant.id), prefix + "缺少 id。");
  assert(/^[a-z0-9][a-z0-9-]*$/.test(restaurant.id), prefix + "的 id 只能包含小写字母、数字和连字符。");
  assert(isNonEmptyString(restaurant.name), prefix + "缺少 name。");
  assert(isNonEmptyString(restaurant.cuisine), prefix + "缺少 cuisine。");
  assert(VALID_RESTAURANT_SCOPES.has(restaurant.scope), prefix + "的 scope 无效。");
  assert(isNonEmptyString(restaurant.location), prefix + "缺少 location。");
  assert(Number.isFinite(restaurant.price_per_person) && restaurant.price_per_person > 0, prefix + "的 price_per_person 必须是正数。");
  assert(isNonEmptyString(restaurant.map_query), prefix + "缺少 map_query。");

  if (restaurant.scope === "primary") {
    assert(restaurant.walking_minutes === null, prefix + "属于主范围，walking_minutes 必须为 null。");
  } else {
    assert(Number.isInteger(restaurant.walking_minutes), prefix + "的 walking_minutes 必须是整数。");
    assert(restaurant.walking_minutes >= 1 && restaurant.walking_minutes <= 8, prefix + "的步行时间必须在 1–8 分钟内。");
  }

  if (restaurant.active !== undefined) {
    assert(typeof restaurant.active === "boolean", prefix + "的 active 必须是布尔值。");
  }

  if (restaurant.pork_free_hint !== undefined) {
    assert(isNonEmptyString(restaurant.pork_free_hint), prefix + "的 pork_free_hint 必须是非空字符串。");
  }

  if (restaurant.recommended_dishes !== undefined) {
    assert(Array.isArray(restaurant.recommended_dishes), prefix + "的 recommended_dishes 必须是数组。");
    assert(restaurant.recommended_dishes.length > 0 && restaurant.recommended_dishes.length <= 5,
      prefix + "的 recommended_dishes 必须包含 1–5 项。");
    restaurant.recommended_dishes.forEach((dish) => {
      assert(isNonEmptyString(dish), prefix + "包含无效的推荐菜。");
    });
  }

  if (restaurant.source_urls !== undefined) {
    assert(Array.isArray(restaurant.source_urls), prefix + "的 source_urls 必须是数组。");
    restaurant.source_urls.forEach((url) => {
      assert(isNonEmptyString(url) && /^https:\/\//i.test(url), prefix + "包含无效来源链接。");
    });
  }

  return clone(restaurant);
}

export function validateRestaurantsDocument(document) {
  assert(isObject(document), "餐厅配置必须是 JSON 对象。");
  assert(document.schema_version === SCHEMA_VERSION, "不支持这个餐厅配置版本。");
  assert(document.type === "restaurants", "文件类型不是 restaurants。");
  assert(Array.isArray(document.restaurants), "restaurants 必须是数组。");
  assert(document.restaurants.length > 0, "餐厅配置不能为空。");

  const ids = new Set();
  const restaurants = document.restaurants.map((restaurant, index) => {
    const validated = validateRestaurant(restaurant, index);
    assert(!ids.has(validated.id), "餐厅 id 重复：" + validated.id + "。");
    ids.add(validated.id);
    return validated;
  });

  return {
    schema_version: SCHEMA_VERSION,
    type: "restaurants",
    verified_at: isNonEmptyString(document.verified_at) ? document.verified_at : null,
    restaurants
  };
}

export function validateSettings(settings) {
  assert(isObject(settings), "settings 必须是对象。");
  assert(VALID_SCOPES.has(settings.scope), "settings.scope 无效。");
  assert(Number.isInteger(settings.cooldown_meals), "cooldown_meals 必须是整数。");
  assert(settings.cooldown_meals >= 0 && settings.cooldown_meals <= 20, "cooldown_meals 必须在 0–20 之间。");
  assert(Number.isFinite(settings.cooldown_weight), "cooldown_weight 必须是数字。");
  assert(settings.cooldown_weight >= 0 && settings.cooldown_weight <= 1, "cooldown_weight 必须在 0–1 之间。");
  return clone(settings);
}

function validateHistory(history) {
  assert(Array.isArray(history), "history 必须是数组。");
  const dates = new Set();

  return history.map((record, index) => {
    const prefix = "第 " + (index + 1) + " 条历史记录";
    assert(isObject(record), prefix + "必须是对象。");
    assert(isValidDateKey(record.date), prefix + "的 date 无效。");
    assert(!dates.has(record.date), "同一天只能有一条午餐记录：" + record.date + "。");
    dates.add(record.date);
    assert(VALID_RECORD_STATUSES.has(record.status), prefix + "的 status 无效。");

    if (record.status === "restaurant") {
      assert(isNonEmptyString(record.restaurant_id), prefix + "缺少 restaurant_id。");
      assert(isNonEmptyString(record.restaurant_name), prefix + "缺少 restaurant_name 快照。");
      assert(VALID_RECORD_SOURCES.has(record.source), prefix + "的 source 无效。");
    } else if (record.reason !== undefined) {
      assert(isNonEmptyString(record.reason), prefix + "的 reason 必须是非空字符串。");
    }

    if (record.updated_at !== undefined) {
      assert(isNonEmptyString(record.updated_at), prefix + "的 updated_at 无效。");
    }

    return clone(record);
  });
}

export function validateState(state) {
  assert(isObject(state), "本地数据必须是对象。");
  assert(state.schema_version === SCHEMA_VERSION, "不支持这个本地数据版本。");

  const restaurantsDocument = validateRestaurantsDocument({
    schema_version: state.schema_version,
    type: "restaurants",
    verified_at: state.restaurants_verified_at,
    restaurants: state.restaurants
  });

  return {
    schema_version: SCHEMA_VERSION,
    settings: validateSettings(state.settings),
    restaurants_verified_at: restaurantsDocument.verified_at,
    restaurants: restaurantsDocument.restaurants,
    history: validateHistory(state.history)
  };
}

export function createInitialState(restaurantsDocument) {
  const validated = validateRestaurantsDocument(restaurantsDocument);
  return {
    schema_version: SCHEMA_VERSION,
    settings: clone(DEFAULT_SETTINGS),
    restaurants_verified_at: validated.verified_at,
    restaurants: validated.restaurants,
    history: []
  };
}

export function validateBackupDocument(document) {
  assert(isObject(document), "完整备份必须是 JSON 对象。");
  assert(document.schema_version === SCHEMA_VERSION, "不支持这个完整备份版本。");
  assert(document.type === "backup", "文件类型不是 backup。");
  if (document.exported_at !== undefined) {
    assert(isNonEmptyString(document.exported_at), "exported_at 无效。");
  }

  return validateState({
    schema_version: document.schema_version,
    settings: document.settings,
    restaurants_verified_at: document.restaurants_verified_at,
    restaurants: document.restaurants,
    history: document.history
  });
}

function restaurantRecordsBefore(history, targetDate) {
  return history
    .filter((record) => record.status === "restaurant")
    .filter((record) => isValidDateKey(record.date) && isWeekday(record.date))
    .filter((record) => record.date < targetDate)
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function getCooldownRestaurantIds(history, targetDate, cooldownMeals = DEFAULT_SETTINGS.cooldown_meals) {
  assert(isValidDateKey(targetDate), "目标日期无效。");
  assert(Number.isInteger(cooldownMeals) && cooldownMeals >= 0, "冷却餐数无效。");
  const recent = restaurantRecordsBefore(history, targetDate).slice(0, cooldownMeals);
  return new Set(recent.map((record) => record.restaurant_id));
}

export function getCandidatePool(restaurants, history, options = {}) {
  const scope = options.scope || DEFAULT_SETTINGS.scope;
  const targetDate = options.targetDate || localDateKey();
  const cooldownMeals = options.cooldownMeals ?? DEFAULT_SETTINGS.cooldown_meals;
  const cooldownWeight = options.cooldownWeight ?? DEFAULT_SETTINGS.cooldown_weight;
  const seenIds = options.seenIds instanceof Set
    ? options.seenIds
    : new Set(options.seenIds || []);

  assert(Array.isArray(restaurants), "restaurants 必须是数组。");
  assert(Array.isArray(history), "history 必须是数组。");
  assert(VALID_SCOPES.has(scope), "抽取范围无效。");
  assert(Number.isFinite(cooldownWeight) && cooldownWeight >= 0, "冷却权重无效。");

  const cooldownIds = getCooldownRestaurantIds(history, targetDate, cooldownMeals);

  return restaurants
    .filter((restaurant) => restaurant.active !== false)
    .filter((restaurant) => scope === "all" || restaurant.scope === scope)
    .filter((restaurant) => !seenIds.has(restaurant.id))
    .map((restaurant) => ({
      restaurant,
      weight: cooldownIds.has(restaurant.id) ? cooldownWeight : 1
    }))
    .filter((candidate) => candidate.weight > 0);
}

export function pickWeighted(candidates, random = Math.random) {
  assert(Array.isArray(candidates), "候选池必须是数组。");
  if (candidates.length === 0) {
    return null;
  }

  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  assert(totalWeight > 0, "候选池总权重必须大于 0。");
  const draw = random();
  assert(Number.isFinite(draw) && draw >= 0 && draw < 1, "随机函数必须返回 [0, 1) 内的数字。");
  let threshold = draw * totalWeight;

  for (const candidate of candidates) {
    threshold -= candidate.weight;
    if (threshold < 0) {
      return candidate.restaurant;
    }
  }

  return candidates[candidates.length - 1].restaurant;
}

export function pickRestaurant(restaurants, history, options = {}, random = Math.random) {
  return pickWeighted(getCandidatePool(restaurants, history, options), random);
}

export function createRestaurantRecord(restaurant, date, source = "manual", updatedAt = new Date().toISOString()) {
  assert(isObject(restaurant), "餐厅无效。");
  assert(isValidDateKey(date), "记录日期无效。");
  assert(isWeekday(date), "周末不创建午餐记录。");
  assert(VALID_RECORD_SOURCES.has(source), "记录来源无效。");

  return {
    date,
    status: "restaurant",
    restaurant_id: restaurant.id,
    restaurant_name: restaurant.name,
    source,
    updated_at: updatedAt
  };
}

export function createSkippedRecord(date, reason = "other", updatedAt = new Date().toISOString()) {
  assert(isValidDateKey(date), "记录日期无效。");
  assert(isWeekday(date), "周末不创建午餐记录。");
  assert(isNonEmptyString(reason), "跳过原因无效。");

  return {
    date,
    status: "skipped",
    reason,
    updated_at: updatedAt
  };
}

export function upsertHistory(history, record) {
  const next = history.filter((item) => item.date !== record.date);
  next.push(clone(record));
  return next.sort((left, right) => right.date.localeCompare(left.date));
}

export function removeHistoryRecord(history, date) {
  assert(isValidDateKey(date), "记录日期无效。");
  return history.filter((record) => record.date !== date).map(clone);
}

export function createRestaurantsExport(state) {
  const validated = validateState(state);
  return {
    schema_version: SCHEMA_VERSION,
    type: "restaurants",
    verified_at: validated.restaurants_verified_at,
    restaurants: validated.restaurants
  };
}

export function createBackupExport(state, exportedAt = new Date().toISOString()) {
  const validated = validateState(state);
  return {
    schema_version: SCHEMA_VERSION,
    type: "backup",
    exported_at: exportedAt,
    settings: validated.settings,
    restaurants_verified_at: validated.restaurants_verified_at,
    restaurants: validated.restaurants,
    history: validated.history
  };
}

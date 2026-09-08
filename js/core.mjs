export const SCHEMA_VERSION = 2;
export const RESTAURANTS_SCHEMA_VERSION = 1;

const LEGACY_STATE_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  scope: "primary",
  cooldown_meals: 2,
  cooldown_weight: 0
});

export const DEFAULT_DIETARY_PREFERENCES = Object.freeze({
  avoid_pork: false
});

export const LEGACY_DEFAULT_RESTAURANT_IDS = Object.freeze([
  "men-wah-bing-sutt",
  "super-thai-malatang",
  "dong-xiaowan",
  "charlies",
  "pizza-hut",
  "kfc",
  "toris",
  "heiseiya",
  "nareya-bistro",
  "solo-sukiyaki",
  "tian-la",
  "minshu-fujian",
  "xiding-dumplings",
  "otf-california",
  "spicy-garden",
  "chaimen-fanr",
  "lanxin",
  "tim-ho-wan",
  "peacock-sichuan",
  "gang-li",
  "fu-miss-chengdu",
  "grassroots-beef",
  "laoxiangji-new-land",
  "yuxingji-new-land",
  "goose-craftsman",
  "xibei-new-may",
  "yonghe-soy-milk",
  "ouji-jingdezhen"
]);

const LEGACY_DEFAULT_RESTAURANT_ID_SET = new Set(LEGACY_DEFAULT_RESTAURANT_IDS);

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

function isRestaurantId(value) {
  return isNonEmptyString(value) && /^[a-z0-9][a-z0-9-]*$/.test(value);
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
  assert(isRestaurantId(restaurant.id), prefix + "的 id 只能包含小写字母、数字和连字符。");
  assert(isNonEmptyString(restaurant.name), prefix + "缺少 name。");
  assert(VALID_RESTAURANT_SCOPES.has(restaurant.scope), prefix + "的 scope 无效。");
  assert(isNonEmptyString(restaurant.location), prefix + "缺少 location。");

  if (restaurant.cuisine !== undefined) {
    assert(isNonEmptyString(restaurant.cuisine), prefix + "的 cuisine 必须是非空字符串。");
  }

  if (restaurant.price_per_person !== undefined) {
    assert(Number.isFinite(restaurant.price_per_person) && restaurant.price_per_person > 0,
      prefix + "的 price_per_person 必须是正数。");
  }

  if (restaurant.map_query !== undefined) {
    assert(isNonEmptyString(restaurant.map_query), prefix + "的 map_query 必须是非空字符串。");
  }

  if (restaurant.scope === "primary") {
    assert(restaurant.walking_minutes === undefined || restaurant.walking_minutes === null,
      prefix + "属于主范围，walking_minutes 必须省略或为 null。");
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

  let aliases;
  if (restaurant.aliases !== undefined) {
    assert(Array.isArray(restaurant.aliases), prefix + "的 aliases 必须是数组。");
    aliases = [];
    const seenAliases = new Set();
    restaurant.aliases.forEach((alias) => {
      assert(isNonEmptyString(alias), prefix + "包含无效别名。");
      const trimmed = alias.trim();
      if (!seenAliases.has(trimmed)) {
        seenAliases.add(trimmed);
        aliases.push(trimmed);
      }
    });
  }

  if (restaurant.recommended_dishes !== undefined) {
    assert(Array.isArray(restaurant.recommended_dishes), prefix + "的 recommended_dishes 必须是数组。");
    assert(restaurant.recommended_dishes.length <= 5,
      prefix + "的 recommended_dishes 最多包含 5 项。");
    restaurant.recommended_dishes.forEach((dish) => {
      assert(isNonEmptyString(dish), prefix + "包含无效的推荐菜。");
    });
  }

  if (restaurant.source_urls !== undefined) {
    assert(Array.isArray(restaurant.source_urls), prefix + "的 source_urls 必须是数组。");
    restaurant.source_urls.forEach((url) => {
      assert(isNonEmptyString(url) && /^https:\/\//i.test(url), prefix + "包含无效来源链接。");
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(prefix + "包含无效来源链接。");
      }
      assert(parsed.protocol === "https:" && !parsed.username && !parsed.password,
        prefix + "包含无效来源链接。");
    });
  }

  const validated = clone(restaurant);
  if (aliases !== undefined) {
    validated.aliases = aliases;
  }
  return validated;
}

function validateLegacyRestaurant(restaurant, index) {
  const prefix = "第 " + (index + 1) + " 家餐厅";
  assert(isObject(restaurant), prefix + "必须是对象。");
  assert(isNonEmptyString(restaurant.cuisine), prefix + "缺少 cuisine。");
  assert(Number.isFinite(restaurant.price_per_person) && restaurant.price_per_person > 0,
    prefix + "的 price_per_person 必须是正数。");
  assert(isNonEmptyString(restaurant.map_query), prefix + "缺少 map_query。");
  if (restaurant.scope === "primary") {
    assert(restaurant.walking_minutes === null, prefix + "属于主范围，walking_minutes 必须为 null。");
  }
  if (restaurant.recommended_dishes !== undefined) {
    assert(Array.isArray(restaurant.recommended_dishes)
      && restaurant.recommended_dishes.length > 0
      && restaurant.recommended_dishes.length <= 5,
      prefix + "的 recommended_dishes 必须包含 1–5 项。");
  }
  return validateRestaurant(restaurant, index);
}

function validateRestaurantArray(restaurants, { allowEmpty = false, legacy = false } = {}) {
  assert(Array.isArray(restaurants), "restaurants 必须是数组。");
  if (!allowEmpty) {
    assert(restaurants.length > 0, "餐厅配置不能为空。");
  }

  const ids = new Set();
  return restaurants.map((restaurant, index) => {
    const validated = legacy
      ? validateLegacyRestaurant(restaurant, index)
      : validateRestaurant(restaurant, index);
    assert(!ids.has(validated.id), "餐厅 id 重复：" + validated.id + "。");
    ids.add(validated.id);
    return validated;
  });
}

export function validateRestaurantsDocument(document) {
  assert(isObject(document), "餐厅配置必须是 JSON 对象。");
  assert(document.schema_version === RESTAURANTS_SCHEMA_VERSION, "不支持这个餐厅配置版本。");
  assert(document.type === "restaurants", "文件类型不是 restaurants。");
  const restaurants = validateRestaurantArray(document.restaurants);

  return {
    schema_version: RESTAURANTS_SCHEMA_VERSION,
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

function validateHistory(history, { allowUnlinked = true } = {}) {
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
      if (allowUnlinked) {
        assert(record.restaurant_id === undefined || record.restaurant_id === null
          || isNonEmptyString(record.restaurant_id), prefix + "的 restaurant_id 无效。");
      } else {
        assert(isNonEmptyString(record.restaurant_id), prefix + "缺少 restaurant_id。");
      }
      assert(isNonEmptyString(record.restaurant_name), prefix + "缺少 restaurant_name 快照。");
      assert(VALID_RECORD_SOURCES.has(record.source), prefix + "的 source 无效。");
    } else if (record.reason !== undefined) {
      assert(isNonEmptyString(record.reason), prefix + "的 reason 必须是非空字符串。");
    }

    if (record.updated_at !== undefined) {
      assert(isNonEmptyString(record.updated_at), prefix + "的 updated_at 无效。");
    }

    const validated = clone(record);
    if (allowUnlinked && record.status === "restaurant" && !isNonEmptyString(record.restaurant_id)) {
      validated.restaurant_id = null;
    }
    return validated;
  });
}

function validateDietaryPreferences(preferences) {
  assert(isObject(preferences), "dietary_preferences 必须是对象。");
  assert(typeof preferences.avoid_pork === "boolean", "dietary_preferences.avoid_pork 必须是布尔值。");
  return { avoid_pork: preferences.avoid_pork };
}

function validateRestaurantIdList(value, fieldName) {
  assert(Array.isArray(value), fieldName + " 必须是数组。");
  const ids = [];
  const seen = new Set();
  value.forEach((id) => {
    assert(isRestaurantId(id), fieldName + " 包含无效餐厅 id。");
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
}

function validatePendingRestaurantNames(value) {
  assert(Array.isArray(value), "pending_restaurant_names 必须是数组。");
  const names = [];
  const seen = new Set();
  value.forEach((name) => {
    assert(isNonEmptyString(name), "pending_restaurant_names 包含无效名称。");
    const trimmed = name.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      names.push(trimmed);
    }
  });
  return names;
}

export function validateState(state) {
  assert(isObject(state), "本地数据必须是对象。");
  assert(state.schema_version === SCHEMA_VERSION, "不支持这个本地数据版本。");

  return {
    schema_version: SCHEMA_VERSION,
    settings: validateSettings(state.settings),
    dietary_preferences: validateDietaryPreferences(state.dietary_preferences),
    personal_restaurants: validateRestaurantArray(state.personal_restaurants, { allowEmpty: true }),
    hidden_shared_restaurant_ids: validateRestaurantIdList(
      state.hidden_shared_restaurant_ids,
      "hidden_shared_restaurant_ids"
    ),
    pending_restaurant_names: validatePendingRestaurantNames(state.pending_restaurant_names),
    history: validateHistory(state.history)
  };
}

export function createInitialState() {
  return {
    schema_version: SCHEMA_VERSION,
    settings: clone(DEFAULT_SETTINGS),
    dietary_preferences: clone(DEFAULT_DIETARY_PREFERENCES),
    personal_restaurants: [],
    hidden_shared_restaurant_ids: [],
    pending_restaurant_names: [],
    history: []
  };
}

export function validateLegacyState(state) {
  assert(isObject(state), "v1 本地数据必须是对象。");
  assert(state.schema_version === LEGACY_STATE_SCHEMA_VERSION, "不支持这个 v1 本地数据版本。");
  assert(state.restaurants_verified_at === undefined
    || state.restaurants_verified_at === null
    || isNonEmptyString(state.restaurants_verified_at),
    "v1 restaurants_verified_at 无效。");

  return {
    schema_version: LEGACY_STATE_SCHEMA_VERSION,
    settings: validateSettings(state.settings),
    restaurants_verified_at: isNonEmptyString(state.restaurants_verified_at)
      ? state.restaurants_verified_at
      : null,
    restaurants: validateRestaurantArray(state.restaurants, { legacy: true }),
    history: validateHistory(state.history, { allowUnlinked: false })
  };
}

export function migrateLegacyState(state) {
  const legacy = validateLegacyState(state);
  return validateState({
    schema_version: SCHEMA_VERSION,
    settings: legacy.settings,
    dietary_preferences: clone(DEFAULT_DIETARY_PREFERENCES),
    personal_restaurants: legacy.restaurants.filter(
      (restaurant) => !LEGACY_DEFAULT_RESTAURANT_ID_SET.has(restaurant.id)
    ),
    hidden_shared_restaurant_ids: [],
    pending_restaurant_names: [],
    history: legacy.history
  });
}

export function resolveEffectiveRestaurants(restaurantsDocument, personalState) {
  const shared = validateRestaurantsDocument(restaurantsDocument);
  const personal = validateState(personalState);
  const hiddenIds = new Set(personal.hidden_shared_restaurant_ids);
  const effective = shared.restaurants.filter((restaurant) => !hiddenIds.has(restaurant.id));
  const sharedIds = new Set(shared.restaurants.map((restaurant) => restaurant.id));

  personal.personal_restaurants.forEach((restaurant) => {
    assert(!sharedIds.has(restaurant.id), "个人餐厅 id 与共享目录冲突：" + restaurant.id + "。");
    effective.push(restaurant);
  });

  return effective;
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
    dietary_preferences: document.dietary_preferences,
    personal_restaurants: document.personal_restaurants,
    hidden_shared_restaurant_ids: document.hidden_shared_restaurant_ids,
    pending_restaurant_names: document.pending_restaurant_names,
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
  return new Set(recent.map((record) => record.restaurant_id).filter(isNonEmptyString));
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
  assert(isNonEmptyString(restaurant.name), "请输入餐厅名称。");
  assert(isValidDateKey(date), "记录日期无效。");
  assert(isWeekday(date), "周末不创建午餐记录。");
  assert(VALID_RECORD_SOURCES.has(source), "记录来源无效。");

  return {
    date,
    status: "restaurant",
    restaurant_id: restaurant.id || null,
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

export function parseRestaurantNames(text) {
  assert(typeof text === "string", "名称输入必须是文本。");
  return [...new Set(text.split(/[,，\r\n]+/).map((name) => name.trim()).filter(Boolean))];
}

export function findRestaurantCandidates(restaurants, text) {
  const normalize = (value) => value.normalize("NFKC").toLowerCase().trim();
  assert(typeof text === "string", "名称输入必须是文本。");
  const query = normalize(text);
  if (!query) return [];
  return restaurants.filter((restaurant) => [restaurant.name, ...(restaurant.aliases || [])]
    .some((name) => normalize(name).includes(query)));
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

export function createBackupExport(state, exportedAt = new Date().toISOString()) {
  const validated = validateState(state);
  return {
    schema_version: SCHEMA_VERSION,
    type: "backup",
    exported_at: exportedAt,
    settings: validated.settings,
    dietary_preferences: validated.dietary_preferences,
    personal_restaurants: validated.personal_restaurants,
    hidden_shared_restaurant_ids: validated.hidden_shared_restaurant_ids,
    pending_restaurant_names: validated.pending_restaurant_names,
    history: validated.history
  };
}

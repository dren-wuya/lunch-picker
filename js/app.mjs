import {
  createBackupExport,
  createInitialState,
  createRestaurantRecord,
  createSkippedRecord,
  getCandidatePool,
  isWeekday,
  localDateKey,
  migrateLegacyState,
  pickWeighted,
  removeHistoryRecord,
  resolveEffectiveRestaurants,
  upsertHistory,
  validateBackupDocument,
  validateRestaurantsDocument,
  validateState
} from "./core.mjs";
import { createView, createViewIntent } from "./view.mjs";

const STORAGE_KEY = "lunch-picker.state.v2";
const LEGACY_STORAGE_KEY = "lunch-picker.state.v1";

export function createController(sharedDocument, initialState, {
  storage = globalThis.localStorage,
  random = Math.random,
  today = localDateKey
} = {}) {
  let state = validateState(initialState);
  let currentRestaurant = null;
  let sessionSeenIds = new Set();
  const sharedRestaurantsDocument = validateRestaurantsDocument(sharedDocument);
  let runtimeRestaurants = resolveEffectiveRestaurants(sharedRestaurantsDocument, state);

  function previousWeekday(date = new Date()) {
    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    while (!isWeekday(localDateKey(candidate))) {
      candidate.setDate(candidate.getDate() - 1);
    }
    return localDateKey(candidate);
  }

  function getTodayRecord() {
    return state.history.find((record) => record.date === today()) || null;
  }

  function commitState(nextState) {
    const validated = validateState(nextState);
    const nextRuntimeRestaurants = resolveEffectiveRestaurants(sharedRestaurantsDocument, validated);
    const serialized = JSON.stringify(validated);
    storage.setItem(STORAGE_KEY, serialized);
    state = validated;
    runtimeRestaurants = nextRuntimeRestaurants;
  }

  function resetDrawSession() {
    currentRestaurant = null;
    sessionSeenIds = new Set();
  }

  function buildDietaryNotice(restaurant) {
    if (!state.dietary_preferences.avoid_pork) {
      return null;
    }
    return restaurant.pork_free_hint
      || "无猪肉信息尚未核实，请到店点餐时确认配料。";
  }

  function presentRestaurant(restaurant) {
    return {
      id: restaurant.id,
      name: restaurant.name,
      scope: restaurant.scope,
      location: restaurant.location,
      cuisine: restaurant.cuisine || null,
      pricePerPerson: restaurant.price_per_person ?? null,
      walkingMinutes: restaurant.walking_minutes ?? null,
      dietaryNotice: buildDietaryNotice(restaurant),
      sourceUrls: (restaurant.source_urls || []).filter((url) => {
        const parsed = new URL(url);
        return !/^(maps\.apple\.com|(.+\.)?amap\.com|map\.baidu\.com|maps\.google\.[a-z.]+)$/.test(parsed.hostname)
          && !(parsed.hostname.startsWith("www.google.") && parsed.pathname.startsWith("/maps"));
      })
    };
  }

  function presentHistoryRecord(record) {
    return {
      date: record.date,
      status: record.status,
      restaurantId: record.status === "restaurant" ? record.restaurant_id ?? null : null,
      restaurantName: record.status === "restaurant" ? record.restaurant_name : null,
      source: record.status === "restaurant" ? record.source : null,
      reason: record.status === "skipped" ? record.reason || null : null,
      isWeekday: isWeekday(record.date)
    };
  }

  function buildViewModel() {
    const todayDate = today();
    const todayRecord = getTodayRecord();
    const activeRestaurants = runtimeRestaurants.filter((restaurant) => restaurant.active !== false);
    return {
      selectedScope: state.settings.scope,
      avoidPork: state.dietary_preferences.avoid_pork,
      today: {
        date: todayDate,
        isWeekday: isWeekday(todayDate),
        record: todayRecord ? presentHistoryRecord(todayRecord) : null
      },
      defaultRecordDate: previousWeekday(new Date(todayDate + "T12:00:00")),
      history: state.history.map(presentHistoryRecord),
      restaurants: activeRestaurants.map(presentRestaurant),
      sharedVerifiedAt: sharedRestaurantsDocument.verified_at,
      currentRestaurant: currentRestaurant ? presentRestaurant(currentRestaurant) : null
    };
  }

  function changeScope(scope) {
    commitState({
      ...state,
      settings: { ...state.settings, scope }
    });
    resetDrawSession();
    return { viewModel: buildViewModel() };
  }

  function drawRestaurant(startNewSession) {
    if (startNewSession) {
      resetDrawSession();
    }

    const options = {
      scope: state.settings.scope,
      targetDate: today(),
      cooldownMeals: state.settings.cooldown_meals,
      cooldownWeight: state.settings.cooldown_weight,
      seenIds: sessionSeenIds
    };
    const pool = getCandidatePool(runtimeRestaurants, state.history, options);
    const restaurant = pickWeighted(pool, random);

    if (!restaurant) {
      currentRestaurant = null;
      return {
        status: "exhausted",
        viewModel: buildViewModel()
      };
    }

    currentRestaurant = restaurant;
    sessionSeenIds.add(restaurant.id);
    const remaining = getCandidatePool(runtimeRestaurants, state.history, {
      ...options,
      seenIds: sessionSeenIds
    }).length;
    return {
      status: "drawn",
      remaining,
      viewModel: buildViewModel()
    };
  }

  function confirmCurrentRestaurant(confirmed) {
    if (!currentRestaurant) {
      return {
        status: "noop",
        viewModel: buildViewModel()
      };
    }

    const todayDate = today();
    if (!isWeekday(todayDate)) {
      throw new Error("周末不会创建午餐记录。");
    }

    if (getTodayRecord() && !confirmed) {
      return { status: "confirmation_required" };
    }

    const record = createRestaurantRecord(currentRestaurant, todayDate, "random");
    commitState({
      ...state,
      history: upsertHistory(state.history, record)
    });
    resetDrawSession();
    return {
      status: "saved",
      restaurantName: record.restaurant_name,
      viewModel: buildViewModel()
    };
  }

  function saveRecord(payload) {
    if (payload.date > today()) {
      throw new Error("只能记录今天或过去的工作日。");
    }
    if (!isWeekday(payload.date)) {
      throw new Error("周末自动忽略，请选择一个工作日。");
    }

    const existingOnNewDate = state.history.find((record) => record.date === payload.date);
    if (existingOnNewDate && payload.date !== payload.originalDate && !payload.confirmed) {
      return { status: "confirmation_required" };
    }

    let record;
    if (payload.status === "restaurant") {
      const selectedRestaurantId = payload.restaurantId || "";
      let restaurant = runtimeRestaurants.find((item) => item.id === selectedRestaurantId);
      if (!restaurant && payload.originalDate) {
        const original = state.history.find((item) => item.date === payload.originalDate);
        if (original && original.status === "restaurant"
          && (original.restaurant_id || "") === selectedRestaurantId) {
          restaurant = {
            id: original.restaurant_id,
            name: original.restaurant_name
          };
        }
      }
      if (!restaurant) {
        throw new Error("所选餐厅已不在当前目录中，请选择其他餐厅。");
      }
      record = createRestaurantRecord(restaurant, payload.date, payload.source);
    } else {
      record = createSkippedRecord(payload.date, payload.reason);
    }

    let nextHistory = state.history;
    if (payload.originalDate && payload.originalDate !== payload.date) {
      nextHistory = removeHistoryRecord(nextHistory, payload.originalDate);
    }
    nextHistory = upsertHistory(nextHistory, record);
    commitState({ ...state, history: nextHistory });
    resetDrawSession();
    return {
      status: "saved",
      viewModel: buildViewModel()
    };
  }

  function deleteRecord(date) {
    commitState({
      ...state,
      history: removeHistoryRecord(state.history, date)
    });
    resetDrawSession();
    return {
      status: "deleted",
      viewModel: buildViewModel()
    };
  }

  function previewBackup(document) {
    const importedState = validateBackupDocument(document);
    resolveEffectiveRestaurants(sharedRestaurantsDocument, importedState);
    return {
      personalRestaurantCount: importedState.personal_restaurants.length,
      hiddenSharedCount: importedState.hidden_shared_restaurant_ids.length,
      pendingNameCount: importedState.pending_restaurant_names.length,
      historyCount: importedState.history.length
    };
  }

  function importBackup(document) {
    const importedState = validateBackupDocument(document);
    commitState(importedState);
    resetDrawSession();
    return {
      status: "imported",
      viewModel: buildViewModel()
    };
  }

  function exportBackup() {
    return createBackupExport(state);
  }

  function handleViewIntent(intent) {
    const { type, ...payload } = intent;
    createViewIntent(type, payload);
    switch (intent.type) {
      case "changeScope":
        return changeScope(intent.scope);
      case "draw":
        return drawRestaurant(intent.startNewSession);
      case "confirmRestaurant":
        return confirmCurrentRestaurant(intent.confirmed);
      case "saveRecord":
        return saveRecord(intent);
      case "deleteRecord":
        return deleteRecord(intent.date);
      case "previewBackup":
        return previewBackup(intent.document);
      case "importBackup":
        return importBackup(intent.document);
      case "exportBackup":
        return exportBackup();
      default:
        throw new Error("未知 view intent：" + intent.type + "。");
    }
  }

  return { dispatch: handleViewIntent, getViewModel: buildViewModel };
}

export function recoverStoredState(v2Stored, legacyStored) {
  let invalidV2Error = null;

  if (v2Stored !== null) {
    try {
      return {
        state: validateState(JSON.parse(v2Stored)),
        shouldPersist: false,
        source: "v2"
      };
    } catch (error) {
      invalidV2Error = error;
    }
  }

  if (legacyStored !== null) {
    try {
      return {
        state: migrateLegacyState(JSON.parse(legacyStored)),
        shouldPersist: true,
        source: "v1"
      };
    } catch (legacyError) {
      const v2Detail = invalidV2Error ? "v2 无效：" + invalidV2Error.message + "；" : "";
      throw new Error(v2Detail + "v1 迁移失败：" + legacyError.message);
    }
  }

  if (invalidV2Error) {
    throw new Error("v2 浏览器本地数据无效，且不存在可迁移的 v1。原因：" + invalidV2Error.message);
  }

  return {
    state: createInitialState(),
    shouldPersist: true,
    source: "initial"
  };
}

export function loadStoredState(sharedRestaurantsDocument, storage = globalThis.localStorage) {
  const stored = storage.getItem(STORAGE_KEY);
  const legacyStored = storage.getItem(LEGACY_STORAGE_KEY);
  const recovery = recoverStoredState(stored, legacyStored);
  const validated = validateState(recovery.state);
  resolveEffectiveRestaurants(sharedRestaurantsDocument, validated);

  if (recovery.shouldPersist) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(validated));
    } catch (error) {
      throw new Error("无法写入 v2 本地数据；旧数据未被覆盖。原因：" + error.message);
    }
  }
  return validated;
}

async function start() {
  let controller = null;
  const view = createView((intent) => controller.dispatch(intent));

  try {
    const response = await fetch("./data/restaurants.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("无法读取共享餐厅目录（HTTP " + response.status + "）。");
    }
    const sharedDocument = validateRestaurantsDocument(await response.json());
    controller = createController(sharedDocument, loadStoredState(sharedDocument));
    view.render(controller.getViewModel());
    view.showInitialRoute();
  } catch (error) {
    view.showLoadError("加载失败：" + error.message + " 请通过 HTTP 静态服务器访问网页。");
  }
}

if (typeof document !== "undefined") {
  start();
}

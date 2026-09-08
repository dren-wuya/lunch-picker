import {
  createBackupExport,
  createInitialState,
  createRestaurantRecord,
  createSkippedRecord,
  findRestaurantCandidates,
  getCandidatePool,
  isWeekday,
  localDateKey,
  migrateLegacyState,
  parseRestaurantNames,
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
  today = localDateKey,
  makePersonalId = () => "personal-" + globalThis.crypto.randomUUID()
} = {}) {
  let state = validateState(initialState);
  let currentRestaurant = null;
  let sessionSeenIds = new Set();
  let pendingPreview = null;
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
      managedRestaurants: [
        ...sharedRestaurantsDocument.restaurants.filter((restaurant) => restaurant.active !== false)
          .map((restaurant) => ({ ...presentManagedRestaurant(restaurant), isPersonal: false,
            isHidden: state.hidden_shared_restaurant_ids.includes(restaurant.id) })),
        ...state.personal_restaurants.map((restaurant) => ({ ...presentManagedRestaurant(restaurant),
          isPersonal: true, isHidden: restaurant.active === false }))
      ],
      pendingNames: state.pending_restaurant_names.map((name) => ({
        name,
        candidates: searchRestaurants(name),
        historyCount: pendingHistory(name).length
      })),
      sharedVerifiedAt: sharedRestaurantsDocument.verified_at,
      currentRestaurant: currentRestaurant ? presentRestaurant(currentRestaurant) : null
    };
  }

  function presentManagedRestaurant(restaurant) {
    return { id: restaurant.id, name: restaurant.name, scope: restaurant.scope, location: restaurant.location };
  }

  function searchRestaurants(text) {
    return findRestaurantCandidates(getFormalRestaurants(), text)
      .map(presentManagedRestaurant);
  }

  function getFormalRestaurants() {
    return [...sharedRestaurantsDocument.restaurants, ...state.personal_restaurants];
  }

  function pendingHistory(name) {
    return state.history.filter((record) => record.status === "restaurant" && !record.restaurant_id
      && record.restaurant_name.trim() === name);
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
      const original = state.history.find((item) => item.date === payload.originalDate);
      let restaurant = selectedRestaurantId
        ? getFormalRestaurants().find((item) => item.id === selectedRestaurantId)
        : { id: null, name: payload.restaurantName };
      if (selectedRestaurantId && original?.status === "restaurant"
        && original.restaurant_id === selectedRestaurantId
        && original.restaurant_name === payload.restaurantName) {
        restaurant = { id: selectedRestaurantId, name: original.restaurant_name };
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
      unlinkedName: record.status === "restaurant" && !record.restaurant_id ? record.restaurant_name : null,
      viewModel: buildViewModel()
    };
  }

  function savePersonalChange(nextState) {
    commitState(nextState);
    resetDrawSession();
    return { viewModel: buildViewModel() };
  }

  function queueNames(names) {
    return savePersonalChange({ ...state,
      pending_restaurant_names: [...state.pending_restaurant_names, ...names] });
  }

  function resolvePending(name, restaurantId, confirmed) {
    if (!state.pending_restaurant_names.includes(name)) throw new Error("待入库名称已不存在。");
    if (!searchRestaurants(name).some((restaurant) => restaurant.id === restaurantId)) {
      throw new Error("请选择这个名称对应的当前候选。");
    }
    const records = pendingHistory(name);
    if (!confirmed) return { status: "confirmation_required", historyCount: records.length };
    const dates = new Set(records.map((record) => record.date));
    return savePersonalChange({ ...state,
      pending_restaurant_names: state.pending_restaurant_names.filter((item) => item !== name),
      history: state.history.map((record) => dates.has(record.date)
        ? { ...record, restaurant_id: restaurantId, updated_at: new Date().toISOString() } : record)
    });
  }

  function setRestaurantHidden(restaurantId, hidden) {
    const personal = state.personal_restaurants.find((restaurant) => restaurant.id === restaurantId);
    if (personal) {
      return savePersonalChange({ ...state, personal_restaurants: state.personal_restaurants
        .map((restaurant) => restaurant.id === restaurantId ? { ...restaurant, active: !hidden } : restaurant) });
    }
    if (!sharedRestaurantsDocument.restaurants.some((restaurant) => restaurant.id === restaurantId)) {
      throw new Error("餐厅已不在当前目录中。");
    }
    return savePersonalChange({ ...state, hidden_shared_restaurant_ids: hidden
      ? [...state.hidden_shared_restaurant_ids, restaurantId]
      : state.hidden_shared_restaurant_ids.filter((id) => id !== restaurantId) });
  }

  function addPersonalRestaurant(payload) {
    const restaurant = {
      id: makePersonalId(), name: payload.name.trim(), scope: payload.scope,
      location: payload.location.trim(), aliases: parseRestaurantNames(payload.aliases),
      ...(payload.scope === "secondary" ? { walking_minutes: payload.walkingMinutes } : {})
    };
    return savePersonalChange({ ...state, personal_restaurants: [...state.personal_restaurants, restaurant] });
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
    pendingPreview = null;
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
      case "searchRestaurants":
        return { candidates: searchRestaurants(intent.text) };
      case "queueName":
        return queueNames([intent.name]);
      case "previewPendingNames": {
        const names = parseRestaurantNames(intent.text);
        if (!names.length) throw new Error("请先输入至少一个名称。");
        pendingPreview = names;
        return { names: [...names], existingCount: names.filter((name) => state.pending_restaurant_names.includes(name)).length };
      }
      case "confirmPendingNames": {
        if (!pendingPreview) throw new Error("请先预览名称列表。");
        const result = queueNames(pendingPreview);
        pendingPreview = null;
        return result;
      }
      case "removePendingName":
        return savePersonalChange({ ...state,
          pending_restaurant_names: state.pending_restaurant_names.filter((name) => name !== intent.name) });
      case "resolvePending":
        return resolvePending(intent.name, intent.restaurantId, intent.confirmed);
      case "setRestaurantHidden":
        return setRestaurantHidden(intent.restaurantId, intent.hidden);
      case "addPersonalRestaurant":
        return addPersonalRestaurant(intent);
      case "setAvoidPork":
        commitState({ ...state, dietary_preferences: { avoid_pork: intent.value } });
        return { viewModel: buildViewModel() };
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

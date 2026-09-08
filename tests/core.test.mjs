import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { recoverStoredState } from "../js/app.mjs";
import {
  createViewIntent,
  validateViewModel,
  VIEW_INTENTS
} from "../js/view.mjs";
import {
  createBackupExport,
  createInitialState,
  createRestaurantRecord,
  createSkippedRecord,
  getCandidatePool,
  getCooldownRestaurantIds,
  isWeekday,
  LEGACY_DEFAULT_RESTAURANT_IDS,
  migrateLegacyState,
  pickRestaurant,
  removeHistoryRecord,
  resolveEffectiveRestaurants,
  upsertHistory,
  validateBackupDocument,
  validateRestaurantsDocument,
  validateState
} from "../js/core.mjs";

const dataUrl = new URL("../data/restaurants.json", import.meta.url);
const restaurantsDocument = JSON.parse(await readFile(dataUrl, "utf8"));
const validatedDocument = validateRestaurantsDocument(restaurantsDocument);
const state = createInitialState();
const restaurants = resolveEffectiveRestaurants(validatedDocument, state);
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../js/app.mjs", import.meta.url), "utf8");
const viewSource = await readFile(new URL("../js/view.mjs", import.meta.url), "utf8");

test("部署版共享目录与 v2 个人状态相互分离", () => {
  assert.ok(restaurants.some((item) => item.scope === "primary"));
  assert.ok(restaurants.some((item) => item.scope === "secondary"));
  assert.equal(state.schema_version, 2);
  assert.equal("restaurants" in state, false);
  assert.equal("restaurants_verified_at" in state, false);
  assert.deepEqual(state.personal_restaurants, []);
});

test("三种范围只返回对应候选池", () => {
  const primary = getCandidatePool(restaurants, [], {
    scope: "primary",
    targetDate: "2026-08-27"
  });
  const secondary = getCandidatePool(restaurants, [], {
    scope: "secondary",
    targetDate: "2026-08-27"
  });
  const all = getCandidatePool(restaurants, [], {
    scope: "all",
    targetDate: "2026-08-27"
  });

  assert.ok(primary.every((item) => item.restaurant.scope === "primary"));
  assert.ok(secondary.every((item) => item.restaurant.scope === "secondary"));
  assert.ok(all.every((item) => item.weight === 1), "价格和范围不应改变普通候选权重");
  assert.equal(all.length, primary.length + secondary.length);
});

test("最近两条有效餐厅记录进入冷却，跳过和周末不消耗冷却", () => {
  const history = [
    createRestaurantRecord(restaurants[0], "2026-08-26", "manual", "2026-08-26T12:00:00.000Z"),
    createSkippedRecord("2026-08-25", "leave", "2026-08-25T12:00:00.000Z"),
    createRestaurantRecord(restaurants[1], "2026-08-24", "manual", "2026-08-24T12:00:00.000Z"),
    {
      date: "2026-08-23",
      status: "restaurant",
      restaurant_id: restaurants[2].id,
      restaurant_name: restaurants[2].name,
      source: "manual",
      updated_at: "2026-08-23T12:00:00.000Z"
    },
    createRestaurantRecord(restaurants[3], "2026-08-21", "manual", "2026-08-21T12:00:00.000Z")
  ];

  const cooldown = getCooldownRestaurantIds(history, "2026-08-27", 2);
  assert.deepEqual([...cooldown], [restaurants[0].id, restaurants[1].id]);

  const pool = getCandidatePool(restaurants, history, {
    scope: "primary",
    targetDate: "2026-08-27",
    cooldownMeals: 2,
    cooldownWeight: 0
  });
  assert.ok(!pool.some((item) => item.restaurant.id === restaurants[0].id));
  assert.ok(!pool.some((item) => item.restaurant.id === restaurants[1].id));
  assert.ok(pool.some((item) => item.restaurant.id === restaurants[3].id));
});

test("冷却权重可以从 0 调整为非零值", () => {
  const history = [
    createRestaurantRecord(restaurants[0], "2026-08-26", "manual", "2026-08-26T12:00:00.000Z")
  ];
  const pool = getCandidatePool(restaurants, history, {
    scope: "primary",
    targetDate: "2026-08-27",
    cooldownWeight: 0.25
  });
  const cooled = pool.find((item) => item.restaurant.id === restaurants[0].id);
  assert.equal(cooled.weight, 0.25);
});

test("同一轮已经展示的餐厅不会再次进入候选池", () => {
  const seen = new Set([restaurants[0].id, restaurants[1].id]);
  const pool = getCandidatePool(restaurants, [], {
    scope: "primary",
    targetDate: "2026-08-27",
    seenIds: seen
  });
  assert.ok(pool.every((item) => !seen.has(item.restaurant.id)));
});

test("注入固定随机数时可以检查等权抽取边界", () => {
  const first = pickRestaurant(restaurants, [], {
    scope: "secondary",
    targetDate: "2026-08-27"
  }, () => 0);
  const last = pickRestaurant(restaurants, [], {
    scope: "secondary",
    targetDate: "2026-08-27"
  }, () => 0.999999);
  assert.equal(first.id, restaurants.find((item) => item.scope === "secondary").id);
  assert.equal(last.id, restaurants.at(-1).id);
});

test("同一天补记会替换旧记录而不是重复累计", () => {
  const first = createRestaurantRecord(restaurants[0], "2026-08-27", "manual");
  const replacement = createRestaurantRecord(restaurants[1], "2026-08-27", "company");
  const history = upsertHistory(upsertHistory([], first), replacement);
  assert.equal(history.length, 1);
  assert.equal(history[0].restaurant_id, restaurants[1].id);
  assert.equal(removeHistoryRecord(history, "2026-08-27").length, 0);
});

test("周末能被识别，手动创建周末记录会明确失败", () => {
  assert.equal(isWeekday("2026-08-29"), false);
  assert.throws(
    () => createRestaurantRecord(restaurants[0], "2026-08-29", "manual"),
    /周末不创建午餐记录/
  );
});

test("v1 迁移保留个人数据并只把额外 id 转成个人餐厅", () => {
  const legacyRestaurants = LEGACY_DEFAULT_RESTAURANT_IDS.map((id, index) => ({
    id,
    name: "旧共享餐厅 " + index,
    cuisine: "简餐",
    scope: "primary",
    location: "L+MALL LG",
    walking_minutes: null,
    price_per_person: 50,
    map_query: "旧共享餐厅 " + index,
    active: true,
    recommended_dishes: ["午餐"]
  }));
  const personalRestaurant = {
    ...legacyRestaurants[0],
    id: "personal-noodle-shop",
    name: "个人面馆"
  };
  const history = [createRestaurantRecord(
    legacyRestaurants[0],
    "2026-08-27",
    "manual",
    "2026-08-27T12:00:00.000Z"
  )];
  const legacyState = {
    schema_version: 1,
    settings: { ...state.settings, scope: "secondary" },
    restaurants_verified_at: "2026-08-27",
    restaurants: [...legacyRestaurants, personalRestaurant],
    history
  };

  const migrated = migrateLegacyState(legacyState);
  assert.equal(migrated.schema_version, 2);
  assert.equal(migrated.settings.scope, "secondary");
  assert.deepEqual(migrated.personal_restaurants.map((item) => item.id), [personalRestaurant.id]);
  assert.deepEqual(migrated.hidden_shared_restaurant_ids, []);
  assert.deepEqual(migrated.pending_restaurant_names, []);
  assert.equal(migrated.history[0].restaurant_name, legacyRestaurants[0].name);
  assert.equal("restaurants" in migrated, false);
});

test("无效 v2 不会阻断有效 v1 迁移，且不会被当成空白初始状态", () => {
  const legacyState = {
    schema_version: 1,
    settings: state.settings,
    restaurants_verified_at: "2026-08-27",
    restaurants: [restaurants[0]],
    history: []
  };
  const recovered = recoverStoredState("{", JSON.stringify(legacyState));
  assert.equal(recovered.source, "v1");
  assert.equal(recovered.shouldPersist, true);
  assert.equal(recovered.state.schema_version, 2);

  assert.throws(
    () => recoverStoredState("{", null),
    /v2 浏览器本地数据无效，且不存在可迁移的 v1/
  );
});

test("共享目录与个人增减项合成，且不允许个人字段覆盖共享 id", () => {
  const personalRestaurant = {
    id: "personal-rice-shop",
    name: "个人饭馆",
    scope: "primary",
    location: "L+MALL LG"
  };
  const personalized = validateState({
    ...state,
    personal_restaurants: [personalRestaurant],
    hidden_shared_restaurant_ids: [restaurants[0].id],
    pending_restaurant_names: ["  待核查餐厅  ", "待核查餐厅"]
  });
  const effective = resolveEffectiveRestaurants(validatedDocument, personalized);
  assert.ok(!effective.some((item) => item.id === restaurants[0].id));
  assert.ok(effective.some((item) => item.id === personalRestaurant.id));
  assert.ok(!effective.some((item) => item.name === "待核查餐厅"));
  assert.deepEqual(personalized.pending_restaurant_names, ["待核查餐厅"]);

  assert.throws(() => resolveEffectiveRestaurants(validatedDocument, {
    ...state,
    hidden_shared_restaurant_ids: [restaurants[0].id],
    personal_restaurants: [{ ...restaurants[0], name: "本地覆盖" }]
  }), /个人餐厅 id 与共享目录冲突/);
});

test("个人备份不复制共享目录并可通过对应校验恢复", () => {
  const history = [createRestaurantRecord(restaurants[0], "2026-08-27", "random")];
  const personalRestaurant = {
    id: "personal-cafe",
    name: "个人咖啡馆",
    scope: "primary",
    location: "L+MALL LG"
  };
  const withPersonalData = validateState({
    ...state,
    personal_restaurants: [personalRestaurant],
    hidden_shared_restaurant_ids: [restaurants[1].id],
    pending_restaurant_names: ["待核查餐厅"],
    history
  });
  const backup = createBackupExport(withPersonalData, "2026-08-27T12:00:00.000Z");

  assert.equal("restaurants" in backup, false);
  assert.equal("restaurants_verified_at" in backup, false);
  const restored = validateBackupDocument(backup);
  assert.deepEqual(restored.personal_restaurants, [personalRestaurant]);
  assert.equal(restored.history[0].restaurant_name, restaurants[0].name);
});

test("餐厅契约允许最小字段、规范化别名，并将推荐菜保留为可选字段", () => {
  const minimal = validateRestaurantsDocument({
    schema_version: 1,
    type: "restaurants",
    verified_at: "2026-09-01",
    restaurants: [{
      id: "minimal-shop",
      name: "最小餐厅",
      scope: "primary",
      location: "L+MALL LG",
      aliases: ["  别名  ", "别名"],
      recommended_dishes: []
    }]
  });
  assert.deepEqual(minimal.restaurants[0].aliases, ["别名"]);
  assert.deepEqual(minimal.restaurants[0].recommended_dishes, []);

  const withoutRecommendations = structuredClone(minimal);
  delete withoutRecommendations.restaurants[0].recommended_dishes;
  assert.equal(validateRestaurantsDocument(withoutRecommendations).restaurants.length, 1);
});

test("餐厅配置会拒绝重复 id、超过 8 分钟的副范围和不安全来源", () => {
  const duplicate = structuredClone(restaurantsDocument);
  duplicate.restaurants[1].id = duplicate.restaurants[0].id;
  assert.throws(() => validateRestaurantsDocument(duplicate), /id 重复/);

  const tooFar = structuredClone(restaurantsDocument);
  const secondary = tooFar.restaurants.find((item) => item.scope === "secondary");
  secondary.walking_minutes = 9;
  assert.throws(() => validateRestaurantsDocument(tooFar), /1–8 分钟/);

  const unsafeSource = structuredClone(restaurantsDocument);
  unsafeSource.restaurants[0].source_urls = ["javascript:alert(1)"];
  assert.throws(() => validateRestaurantsDocument(unsafeSource), /包含无效来源链接/);
});

test("页面 id 唯一，应用缓存的元素都存在于 HTML", () => {
  const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length);

  const cacheBlock = viewSource.match(/\n  \[\n([\s\S]*?)\n  \]\.forEach\(\(id\)/);
  assert.ok(cacheBlock, "无法定位 view 元素缓存列表");
  const cachedIds = [...cacheBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  cachedIds.forEach((id) => assert.ok(htmlIds.includes(id), "HTML 缺少 #" + id));
});

test("正式餐厅最低字段不可缺失，副范围步行时间只接受1至8的整数", () => {
  const minimal = { schema_version: 1, type: "restaurants", restaurants: [
    { id: "minimal", name: "测试店", scope: "primary", location: "LG01" }
  ] };
  for (const field of ["id", "name", "scope", "location"]) {
    const invalid = structuredClone(minimal);
    delete invalid.restaurants[0][field];
    assert.throws(() => validateRestaurantsDocument(invalid), new RegExp(field));
  }
  for (const minutes of [0, 9, 1.5, "8", null]) {
    const invalid = structuredClone(minimal);
    Object.assign(invalid.restaurants[0], { scope: "secondary", walking_minutes: minutes });
    assert.throws(() => validateRestaurantsDocument(invalid), /walking_minutes|1–8/);
  }
  for (const minutes of [1, 8]) {
    const valid = structuredClone(minimal);
    Object.assign(valid.restaurants[0], { scope: "secondary", walking_minutes: minutes });
    assert.equal(validateRestaurantsDocument(valid).restaurants.length, 1);
  }
});

test("页面只有个人备份入口，推荐菜字段不参与展示", () => {
  assert.match(html, /id="export-backup-button"/);
  assert.match(html, /id="import-backup-input"/);
  assert.doesNotMatch(html, /export-restaurants-button|import-restaurants-input|午餐建议/);
  assert.doesNotMatch(appSource + viewSource, /recommended_dishes|createRestaurantsExport/);
});

test("第一版页面不提供地图入口", () => {
  assert.doesNotMatch(html, /id="result-map"|高德地图中查看/);
  assert.doesNotMatch(appSource + viewSource, /uri\.amap\.com|function getMapUrl|result-map/);
});

test("GitHub Pages 所需资源全部使用仓库内相对路径", () => {
  assert.match(html, /href="\.\/styles\.css(?:\?[^"\s]*)?"/);
  assert.match(html, /src="\.\/js\/app\.mjs"/);
  assert.match(appSource, /fetch\("\.\/data\/restaurants\.json"/);
});

test("说明页公开算法并由当前餐厅配置渲染目录", () => {
  assert.match(html, /id="view-guide"/);
  assert.match(html, /最近两条有效餐厅午餐记录/);
  assert.match(html, /价格、菜系和远近不参与加权/);
  assert.match(html, /id="restaurant-directory"/);
  assert.match(viewSource, /function renderGuide\(\)/);
  assert.match(viewSource, /viewModel\.restaurants\.filter/);
});

test("controller 与 view 通过固定意图和普通 view model 连接", () => {
  assert.deepEqual(VIEW_INTENTS, [
    "changeScope",
    "draw",
    "confirmRestaurant",
    "saveRecord",
    "deleteRecord",
    "searchRestaurants",
    "queueName",
    "previewPendingNames",
    "confirmPendingNames",
    "removePendingName",
    "resolvePending",
    "setRestaurantHidden",
    "addPersonalRestaurant",
    "setAvoidPork",
    "previewBackup",
    "importBackup",
    "exportBackup"
  ]);
  const saveIntent = createViewIntent("saveRecord", {
    originalDate: null,
    date: "2026-09-01",
    status: "restaurant",
    restaurantId: "minimal-shop",
    restaurantName: "最小餐厅",
    source: "manual",
    reason: "other",
    confirmed: false
  });
  assert.equal(saveIntent.type, "saveRecord");
  assert.equal(saveIntent.restaurantId, "minimal-shop");
  assert.throws(
    () => createViewIntent("saveRecord", { date: "2026-09-01" }),
    /saveRecord payload 字段必须恰好为/
  );
  assert.throws(
    () => createViewIntent("draw", { startNewSession: true, leak: "domain-value" }),
    /draw payload 字段必须恰好为/
  );

  const restaurantModel = {
    id: "minimal-shop",
    name: "最小餐厅",
    scope: "primary",
    location: "LG",
    cuisine: null,
    pricePerPerson: null,
    walkingMinutes: null,
    dietaryNotice: null,
    sourceUrls: []
  };
  const historyModel = {
    date: "2026-09-01",
    status: "restaurant",
    restaurantId: "minimal-shop",
    restaurantName: "最小餐厅",
    source: "manual",
    reason: null,
    isWeekday: true
  };

  const contractModel = {
    selectedScope: "primary",
    avoidPork: false,
    today: { date: "2026-09-01", isWeekday: true, record: historyModel },
    defaultRecordDate: "2026-09-01",
    history: [historyModel],
    restaurants: [restaurantModel],
    managedRestaurants: [],
    pendingNames: [],
    sharedVerifiedAt: null,
    currentRestaurant: restaurantModel
  };
  assert.equal(validateViewModel(contractModel), contractModel);
  assert.throws(() => validateViewModel({ ...contractModel, selectedScope: "invalid" }), /selectedScope 无效/);
  assert.throws(
    () => validateViewModel({
      ...contractModel,
      restaurants: [{ ...restaurantModel, price_per_person: 50 }]
    }),
    /view model\.restaurants\[0\] 字段必须恰好为/
  );
  assert.throws(
    () => validateViewModel({
      ...contractModel,
      history: [{ ...historyModel, internal_note: "不应暴露" }]
    }),
    /view model\.history\[0\] 字段必须恰好为/
  );

  assert.doesNotMatch(viewSource, /from "\.\/core\.mjs"|localStorage/);
  assert.doesNotMatch(viewSource, /price_per_person|walking_minutes|pork_free_hint|source_urls|\.active/);
  assert.doesNotMatch(appSource, /document\.(?:getElementById|querySelector|createElement)|addEventListener|showModal/);
  assert.match(appSource, /function handleViewIntent\(intent\)/);
  assert.match(appSource, /createView\(\(intent\) => controller\.dispatch\(intent\)\)/);
  assert.match(appSource, /view\.render\(controller\.getViewModel\(\)\)/);
});

test("应用固定读取共享目录，并在 v2 不存在时迁移但保留 v1 key", () => {
  assert.match(appSource, /lunch-picker\.state\.v2/);
  assert.match(appSource, /lunch-picker\.state\.v1/);
  assert.match(appSource, /migrateLegacyState/);
  assert.match(appSource, /resolveEffectiveRestaurants/);
  assert.doesNotMatch(appSource, /removeItem\(LEGACY_STORAGE_KEY\)/);
  assert.doesNotMatch(appSource, /state\.restaurants/);
});

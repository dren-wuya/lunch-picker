import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createBackupExport,
  createInitialState,
  createRestaurantRecord,
  createRestaurantsExport,
  createSkippedRecord,
  getCandidatePool,
  getCooldownRestaurantIds,
  isWeekday,
  pickRestaurant,
  removeHistoryRecord,
  upsertHistory,
  validateBackupDocument,
  validateRestaurantsDocument
} from "../js/core.mjs";

const dataUrl = new URL("../data/restaurants.json", import.meta.url);
const restaurantsDocument = JSON.parse(await readFile(dataUrl, "utf8"));
const validatedDocument = validateRestaurantsDocument(restaurantsDocument);
const state = createInitialState(validatedDocument);
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../js/app.mjs", import.meta.url), "utf8");

test("默认白名单包含 20 家主范围和 8 家副范围餐厅", () => {
  assert.equal(state.restaurants.filter((item) => item.scope === "primary").length, 20);
  assert.equal(state.restaurants.filter((item) => item.scope === "secondary").length, 8);
  assert.ok(state.restaurants.every((item) => item.recommended_dishes.length >= 1));
});

test("三种范围只返回对应候选池", () => {
  const primary = getCandidatePool(state.restaurants, [], {
    scope: "primary",
    targetDate: "2026-08-27"
  });
  const secondary = getCandidatePool(state.restaurants, [], {
    scope: "secondary",
    targetDate: "2026-08-27"
  });
  const all = getCandidatePool(state.restaurants, [], {
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
    createRestaurantRecord(state.restaurants[0], "2026-08-26", "manual", "2026-08-26T12:00:00.000Z"),
    createSkippedRecord("2026-08-25", "leave", "2026-08-25T12:00:00.000Z"),
    createRestaurantRecord(state.restaurants[1], "2026-08-24", "manual", "2026-08-24T12:00:00.000Z"),
    {
      date: "2026-08-23",
      status: "restaurant",
      restaurant_id: state.restaurants[2].id,
      restaurant_name: state.restaurants[2].name,
      source: "manual",
      updated_at: "2026-08-23T12:00:00.000Z"
    },
    createRestaurantRecord(state.restaurants[3], "2026-08-21", "manual", "2026-08-21T12:00:00.000Z")
  ];

  const cooldown = getCooldownRestaurantIds(history, "2026-08-27", 2);
  assert.deepEqual([...cooldown], [state.restaurants[0].id, state.restaurants[1].id]);

  const pool = getCandidatePool(state.restaurants, history, {
    scope: "primary",
    targetDate: "2026-08-27",
    cooldownMeals: 2,
    cooldownWeight: 0
  });
  assert.ok(!pool.some((item) => item.restaurant.id === state.restaurants[0].id));
  assert.ok(!pool.some((item) => item.restaurant.id === state.restaurants[1].id));
  assert.ok(pool.some((item) => item.restaurant.id === state.restaurants[3].id));
});

test("冷却权重可以从 0 调整为非零值", () => {
  const history = [
    createRestaurantRecord(state.restaurants[0], "2026-08-26", "manual", "2026-08-26T12:00:00.000Z")
  ];
  const pool = getCandidatePool(state.restaurants, history, {
    scope: "primary",
    targetDate: "2026-08-27",
    cooldownWeight: 0.25
  });
  const cooled = pool.find((item) => item.restaurant.id === state.restaurants[0].id);
  assert.equal(cooled.weight, 0.25);
});

test("同一轮已经展示的餐厅不会再次进入候选池", () => {
  const seen = new Set([state.restaurants[0].id, state.restaurants[1].id]);
  const pool = getCandidatePool(state.restaurants, [], {
    scope: "primary",
    targetDate: "2026-08-27",
    seenIds: seen
  });
  assert.ok(pool.every((item) => !seen.has(item.restaurant.id)));
});

test("注入固定随机数时可以检查等权抽取边界", () => {
  const first = pickRestaurant(state.restaurants, [], {
    scope: "secondary",
    targetDate: "2026-08-27"
  }, () => 0);
  const last = pickRestaurant(state.restaurants, [], {
    scope: "secondary",
    targetDate: "2026-08-27"
  }, () => 0.999999);
  assert.equal(first.id, state.restaurants.find((item) => item.scope === "secondary").id);
  assert.equal(last.id, state.restaurants.at(-1).id);
});

test("同一天补记会替换旧记录而不是重复累计", () => {
  const first = createRestaurantRecord(state.restaurants[0], "2026-08-27", "manual");
  const replacement = createRestaurantRecord(state.restaurants[1], "2026-08-27", "company");
  const history = upsertHistory(upsertHistory([], first), replacement);
  assert.equal(history.length, 1);
  assert.equal(history[0].restaurant_id, state.restaurants[1].id);
  assert.equal(removeHistoryRecord(history, "2026-08-27").length, 0);
});

test("周末能被识别，手动创建周末记录会明确失败", () => {
  assert.equal(isWeekday("2026-08-29"), false);
  assert.throws(
    () => createRestaurantRecord(state.restaurants[0], "2026-08-29", "manual"),
    /周末不创建午餐记录/
  );
});

test("两类导出都可以通过对应校验并恢复", () => {
  const history = [createRestaurantRecord(state.restaurants[0], "2026-08-27", "random")];
  const withHistory = { ...state, history };
  const restaurantsExport = createRestaurantsExport(withHistory);
  const backupExport = createBackupExport(withHistory, "2026-08-27T12:00:00.000Z");

  assert.equal(validateRestaurantsDocument(restaurantsExport).restaurants.length, 28);
  const restored = validateBackupDocument(backupExport);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.history[0].restaurant_name, state.restaurants[0].name);
});

test("餐厅配置导入会拒绝重复 id 和超过 8 分钟的副范围", () => {
  const duplicate = structuredClone(restaurantsDocument);
  duplicate.restaurants[1].id = duplicate.restaurants[0].id;
  assert.throws(() => validateRestaurantsDocument(duplicate), /id 重复/);

  const tooFar = structuredClone(restaurantsDocument);
  const secondary = tooFar.restaurants.find((item) => item.scope === "secondary");
  secondary.walking_minutes = 9;
  assert.throws(() => validateRestaurantsDocument(tooFar), /1–8 分钟/);

  const emptyRecommendations = structuredClone(restaurantsDocument);
  emptyRecommendations.restaurants[0].recommended_dishes = [];
  assert.throws(() => validateRestaurantsDocument(emptyRecommendations), /recommended_dishes 必须包含 1–5 项/);

  const unsafeSource = structuredClone(restaurantsDocument);
  unsafeSource.restaurants[0].source_urls = ["javascript:alert(1)"];
  assert.throws(() => validateRestaurantsDocument(unsafeSource), /包含无效来源链接/);
});

test("页面 id 唯一，应用缓存的元素都存在于 HTML", () => {
  const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length);

  const cacheBlock = appSource.match(/function cacheElements\(\) \{[\s\S]*?\[([\s\S]*?)\]\.forEach/);
  assert.ok(cacheBlock, "无法定位 cacheElements 列表");
  const cachedIds = [...cacheBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  cachedIds.forEach((id) => assert.ok(htmlIds.includes(id), "HTML 缺少 #" + id));
});

test("GitHub Pages 所需资源全部使用仓库内相对路径", () => {
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/js\/app\.mjs"/);
  assert.match(appSource, /fetch\("\.\/data\/restaurants\.json"/);
});

test("说明页公开算法并由当前餐厅配置渲染目录", () => {
  assert.match(html, /id="view-guide"/);
  assert.match(html, /最近两条有效餐厅午餐记录/);
  assert.match(html, /价格、菜系和远近不参与加权/);
  assert.match(html, /id="restaurant-directory"/);
  assert.match(appSource, /function renderGuide\(\)/);
  assert.match(appSource, /state\.restaurants\.filter/);
});

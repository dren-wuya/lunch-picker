import { readFile } from "node:fs/promises";
import { validateRestaurantsDocument } from "../js/core.mjs";

try {
  const input = process.argv[2] || new URL("../data/restaurants.json", import.meta.url);
  const document = validateRestaurantsDocument(JSON.parse(await readFile(input, "utf8")));
  console.log("Restaurant data valid: " + document.restaurants.length + " entries.");
} catch (error) {
  console.error("Restaurant data invalid: " + error.message);
  process.exitCode = 1;
}

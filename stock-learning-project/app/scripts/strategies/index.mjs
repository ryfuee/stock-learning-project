import { momentumScoreStrategy } from "./momentum-score.mjs";
import { turtleStrategy } from "./turtle.mjs";

export const strategies = [momentumScoreStrategy, turtleStrategy];

export function availableStrategies() {
  return strategies.map(({ id, name, description, minHistory }) => ({ id, name, description, minHistory }));
}

export function resolveStrategy(id = "momentum-score") {
  const normalized = String(id || "momentum-score").trim();
  const strategy = strategies.find((item) => item.id === normalized);
  if (!strategy) {
    throw new Error(`未知策略：${normalized}。可用策略：${strategies.map((item) => item.id).join(", ")}`);
  }
  return strategy;
}

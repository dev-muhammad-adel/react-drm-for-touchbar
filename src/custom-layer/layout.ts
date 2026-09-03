export const CUSTOM_LAYER_GRID_SIZE = 10;

export function snapToGrid(value: number, gridSize: number = CUSTOM_LAYER_GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

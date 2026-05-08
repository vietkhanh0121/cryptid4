import { randomItem } from "./randomUtils";
import { setCellMark, markersForCell } from "./marks";

// -----------------------------------------------------------------------
// computePenaltyX
// Chọn ngẫu nhiên một ô không có X và không khớp hint của player để đặt X phạt.
// Trả về { marks, messagePart, cellId }.
// -----------------------------------------------------------------------
export function computePenaltyX(player, marks, puzzle, selectedHintResult) {
  const candidates = puzzle.map.cells.filter(
    (cell) =>
      !Object.values(markersForCell(marks, cell.id)).includes("X") &&
      !selectedHintResult(player, cell)
  );
  const penaltyCell = randomItem(candidates);
  if (!penaltyCell) {
    return { marks, messagePart: "Không tìm thấy ô phạt hợp lệ.", cellId: null };
  }
  return {
    marks: setCellMark(marks, penaltyCell.id, player, "X"),
    messagePart: `P${player} đã đặt X phạt`,
    cellId: penaltyCell.id,
  };
}

// -----------------------------------------------------------------------
// decideBotAction
// Quyết định bot nên "guess" hay "ask" trong lượt này.
// config.guessThreshold: số candidate tối đa để bot quyết định đoán.
// Bot sẽ hỏi khi còn nhiều lựa chọn, và chuyển sang đoán khi đã thu hẹp đủ.
// -----------------------------------------------------------------------
export function decideBotAction(player, config, puzzle, botCanConsiderGuessCell) {
  const candidateCount = puzzle.map.cells.filter((cell) => botCanConsiderGuessCell(player, cell)).length;
  return candidateCount > 0 && candidateCount <= config.guessThreshold ? "guess" : "ask";
}

// -----------------------------------------------------------------------
// selectAskTarget
// Chọn người chơi để hỏi.
// config.humanBias: xác suất ưu tiên hỏi human thay vì bot — human mang thông
// tin thật sự (hint ẩn), bot khác đã bị auto-resolve nên ít giá trị hơn.
// -----------------------------------------------------------------------
export function selectAskTarget(player, config, humanPlayers, turnOrder) {
  const targetPlayers = turnOrder.filter((p) => p !== player);
  const humanTargets = targetPlayers.filter((p) => humanPlayers.includes(p));
  if (humanTargets.length && Math.random() < config.humanBias) {
    return randomItem(humanTargets);
  }
  return randomItem(targetPlayers);
}

// -----------------------------------------------------------------------
// selectAskCell
// Chọn ô để hỏi.
// config.cellBias: xác suất chọn ô đã khớp với hint của mình (informedCells)
// thay vì bất kỳ ô còn mở nào. Bot mạnh sẽ hỏi về ô mà nó đã biết là hợp lệ
// để tận dụng thông tin — thu hẹp vị trí quái vật nhanh hơn.
// -----------------------------------------------------------------------
export function selectAskCell(player, config, puzzle, cellHasX, selectedHintResult) {
  const openCells = puzzle.map.cells.filter((cell) => !cellHasX(cell.id));
  const informedCells = openCells.filter((cell) => selectedHintResult(player, cell));
  const candidates =
    Math.random() < config.cellBias && informedCells.length ? informedCells : openCells;
  return randomItem(candidates);
}

// -----------------------------------------------------------------------
// selectGuessCell
// Chọn ô để đoán vị trí quái vật.
// Lấy ngẫu nhiên trong số các ô bot được phép đoán (khớp hint, chưa có X, ...).
// -----------------------------------------------------------------------
export function selectGuessCell(player, puzzle, botCanConsiderGuessCell) {
  const candidates = puzzle.map.cells.filter((cell) => botCanConsiderGuessCell(player, cell));
  return randomItem(candidates);
}

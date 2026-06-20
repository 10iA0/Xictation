// 详情页脚本：听写卡片、改正、分析、标注

const container = document.querySelector(".detail-container");
const dictationId = container?.dataset.dictationId || null;

// ========== 听写记录自动保存（已有听写时） ==========
let headerSaveTimer = null;

function scheduleHeaderSave() {
  if (!dictationId) return;
  clearTimeout(headerSaveTimer);
  headerSaveTimer = setTimeout(saveDictationSilent, 800);
}

async function saveDictationSilent() {
  if (!dictationId) return;
  const title = document.getElementById("dictation-title").value.trim();
  if (!title) return;
  const audio = document.getElementById("dictation-audio").value.trim();
  const tags = collectTags();
  try {
    await fetch(`/api/dictations/${dictationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, audio_source: audio, tags }),
    });
  } catch (e) {
    // 静默失败
  }
}

// 为已有听写绑定自动保存监听
if (dictationId) {
  ["dictation-title", "dictation-audio"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", (e) => {
        if (!e.isComposing) scheduleHeaderSave();
      });
      el.addEventListener("compositionend", () => scheduleHeaderSave());
      el.addEventListener("blur", saveDictationSilent);
    }
  });
}

// ========== 听写记录保存（新建时使用） ==========
async function saveDictation() {
  const title = document.getElementById("dictation-title").value.trim();
  const audio = document.getElementById("dictation-audio").value.trim();
  const tags = collectTags();

  if (!title) {
    showToast("请输入标题");
    return null;
  }

  const payload = { title, audio_source: audio, tags };
  const url = dictationId
    ? `/api/dictations/${dictationId}`
    : "/api/dictations";
  const method = dictationId ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const data = await res.json();
    if (!dictationId) {
      window.location.href = `/dictations/${data.id}`;
    }
    return data;
  } else {
    showToast("保存失败");
    return null;
  }
}

// 返回按钮：新建听写时先保存再跳转
async function handleBack() {
  if (!dictationId) {
    const title = document.getElementById("dictation-title").value.trim();
    if (title) {
      // 有标题则保存
      const audio = document.getElementById("dictation-audio").value.trim();
      const tags = collectTags();
      try {
        await fetch("/api/dictations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, audio_source: audio, tags }),
        });
      } catch (e) {
        // 忽略错误，继续跳转
      }
    }
  }
  window.location.href = "/dictations";
  return false;
}

// ========== 标签管理（chip 组件） ==========
function collectTags() {
  return Array.from(document.querySelectorAll("#tags-chips .tag-chip")).map(
    (chip) => chip.dataset.tag,
  );
}

function handleTagKeydown(e) {
  if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    addTagFromInput();
  }
  if (e.key === "Escape") {
    e.target.value = "";
  }
}

function addTagFromInput() {
  const input = document.getElementById("dictation-tag-input");
  const value = input.value.trim();
  if (!value) return;

  // 去重检查
  const existing = collectTags();
  if (existing.includes(value)) {
    showToast("该标签已存在");
    input.value = "";
    return;
  }

  const chipsContainer = document.getElementById("tags-chips");
  const chip = document.createElement("span");
  chip.className = "tag-chip";
  chip.dataset.tag = value;
  chip.innerHTML = `${escapeHtml(value)}<button class="tag-remove" onclick="removeTag(this)">×</button>`;
  chipsContainer.appendChild(chip);
  input.value = "";
  scheduleHeaderSave();
}

function removeTag(btn) {
  btn.closest(".tag-chip").remove();
  scheduleHeaderSave();
}

// ========== 卡片管理 ==========
async function addCard() {
  if (!dictationId) {
    // 新建听写：先创建听写记录，再跳转到详情页
    const title = document.getElementById("dictation-title").value.trim();
    if (!title) {
      showToast("请先输入标题");
      return;
    }
    const audio = document.getElementById("dictation-audio").value.trim();
    const tags = collectTags();
    const res = await fetch("/api/dictations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, audio_source: audio, tags }),
    });
    if (res.ok) {
      const data = await res.json();
      // 创建第一张卡片
      await fetch(`/api/dictations/${data.id}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      });
      window.location.href = `/dictations/${data.id}`;
    } else {
      showToast("创建失败");
    }
    return;
  }
  const res = await fetch(`/api/dictations/${dictationId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "" }),
  });
  if (res.ok) {
    window.location.reload();
  } else {
    showToast("创建卡片失败");
  }
}

async function deleteCard(cardId) {
  if (!(await showInlineConfirm("确认删除该卡片？"))) return;
  const res = await fetch(`/api/cards/${cardId}`, { method: "DELETE" });
  if (res.ok) {
    document.querySelector(`.card-row[data-card-id="${cardId}"]`)?.remove();
  } else {
    showToast("删除失败");
  }
}

// ========== 卡片拖拽排序 ==========
function initCardDragSort() {
  const container = document.getElementById("cards-container");
  if (!container) return;
  let draggedItem = null;

  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".card-row");
    if (!item) return;
    // 不从分析卡片/结构卡片内部发起拖拽
    if (e.target.closest(".analysis-card, .structure-card, textarea, input, button")) {
      e.preventDefault();
      return;
    }
    draggedItem = item;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  container.addEventListener("dragend", (e) => {
    const item = e.target.closest(".card-row");
    if (item) item.classList.remove("dragging");
    if (!draggedItem) return;
    draggedItem = null;
    // 保存新顺序
    const newOrder = Array.from(container.querySelectorAll(".card-row")).map(
      (r) => parseInt(r.dataset.cardId),
    );
    fetch(`/api/dictations/${dictationId}/cards/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: newOrder }),
    });
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!draggedItem) return;
    const afterElement = getCardDragAfterElement(container, draggedItem, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggedItem);
    } else {
      container.insertBefore(draggedItem, afterElement);
    }
  });
}

function getCardDragAfterElement(container, draggedItem, y) {
  const items = [...container.querySelectorAll(".card-row:not(.dragging)")];
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: -Infinity },
  ).element;
}

document.addEventListener("DOMContentLoaded", initCardDragSort);

// ========== 结构卡片展开/收起 ==========
function toggleExtra(btn) {
  const cardRow = btn.closest(".card-row");
  if (!cardRow) return;
  const structureCard = cardRow.querySelector(".structure-card");
  if (!structureCard) return;
  structureCard.style.display = "block";
  // 按钮变灰
  btn.classList.add("btn-disabled");
  btn.disabled = true;

  // 根据内容初始化模式
  const translationInput = cardRow.querySelector(".card-translation-input");
  const analysisInput = cardRow.querySelector(".card-analysis-input");
  const hasContent =
    (translationInput && translationInput.value.trim()) ||
    (analysisInput && analysisInput.value.trim());
  if (hasContent) {
    initStructureDisplayMode(cardRow);
  } else {
    initStructureEditMode(cardRow);
  }
}

function closeStructure(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  const structureCard = cardRow.querySelector(".structure-card");
  if (structureCard) structureCard.style.display = "none";
  // 恢复"结构分析"按钮
  const btn = cardRow.querySelector(".btn-toggle-extra");
  if (btn) {
    btn.classList.remove("btn-disabled");
    btn.disabled = false;
  }
}

function initStructureEditMode(cardRow) {
  const translationInput = cardRow.querySelector(".card-translation-input");
  const analysisInput = cardRow.querySelector(".card-analysis-input");
  const translationDisplay = cardRow.querySelector(".card-translation-display");
  const analysisDisplay = cardRow.querySelector(".card-analysis-display");
  const translateBtn = cardRow.querySelector(".btn-translate");
  const saveBtn = cardRow.querySelector(".btn-save-structure");

  if (translationInput) translationInput.style.display = "block";
  if (analysisInput) analysisInput.style.display = "block";
  if (translationDisplay) translationDisplay.style.display = "none";
  if (analysisDisplay) analysisDisplay.style.display = "none";
  if (translateBtn) translateBtn.style.display = "";
  if (saveBtn) {
    saveBtn.textContent = "保存";
    saveBtn.onclick = () => saveStructure(cardRow.dataset.cardId);
  }
}

function initStructureDisplayMode(cardRow) {
  const translationInput = cardRow.querySelector(".card-translation-input");
  const analysisInput = cardRow.querySelector(".card-analysis-input");
  const translationDisplay = cardRow.querySelector(".card-translation-display");
  const analysisDisplay = cardRow.querySelector(".card-analysis-display");
  const translateBtn = cardRow.querySelector(".btn-translate");
  const saveBtn = cardRow.querySelector(".btn-save-structure");

  if (translationInput && translationDisplay) {
    translationDisplay.textContent = translationInput.value;
    translationInput.style.display = "none";
    translationDisplay.style.display = "block";
  }
  if (analysisInput && analysisDisplay) {
    analysisDisplay.textContent = analysisInput.value;
    analysisInput.style.display = "none";
    analysisDisplay.style.display = "block";
  }
  if (translateBtn) translateBtn.style.display = "none";
  if (saveBtn) {
    saveBtn.textContent = "编辑";
    saveBtn.onclick = () => editStructure(cardRow.dataset.cardId);
  }
}

async function saveStructure(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  const translationInput = cardRow.querySelector(".card-translation-input");
  const analysisInput = cardRow.querySelector(".card-analysis-input");
  const translation = translationInput ? translationInput.value : "";
  const analysis = analysisInput ? analysisInput.value : "";

  const res = await fetch(`/api/cards/${cardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ translation, analysis }),
  });
  if (!res.ok) {
    showToast("保存失败");
    return;
  }
  // 切换为展示模式
  initStructureDisplayMode(cardRow);
}

function editStructure(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  initStructureEditMode(cardRow);
}

// ========== 卡片保存（听写+正确内容统一保存，单词粒度对比） ==========
async function saveCard(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  const contentInput = cardRow.querySelector(".card-content-input");
  const correctInput = cardRow.querySelector(".correct-content-input");
  const content = contentInput.value;
  const correctContent = correctInput.value;

  // 保存到数据库
  const res = await fetch(`/api/cards/${cardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, correct_content: correctContent }),
  });

  if (!res.ok) {
    showToast("保存失败");
    return;
  }

  // 切换为展示模式：以单词为粒度对比，两边排版一致便于逐词对比
  const originalDisplay = cardRow.querySelector(".card-content-display");
  const correctDisplay = cardRow.querySelector(".correct-content-display");

  const diffResult = diffWords(content, correctContent);
  originalDisplay.innerHTML = diffResult.original;
  correctDisplay.innerHTML = diffResult.correct;

  // 先退出编辑模式，再渲染标注（确保×按钮不显示）
  correctDisplay.classList.remove("annotation-preview-live");

  // 渲染标注
  const blocks = cardRow.querySelectorAll(".content-block");
  blocks.forEach((block) => {
    const cid = block.dataset.cardId;
    if (cid && block.querySelector(".correct-content-display")) {
      renderAnnotations(cid, block);
    }
  });

  // 切换显示
  contentInput.style.display = "none";
  correctInput.style.display = "none";
  originalDisplay.style.display = "block";
  correctDisplay.style.display = "block";

  // 隐藏标注工具栏（展示模式下不可用）
  const toolbar = cardRow.querySelector(".correct-toolbar");
  if (toolbar) toolbar.style.display = "none";

  // 替换保存按钮为编辑按钮
  const saveBtn = cardRow.querySelector(".btn-save-card");
  saveBtn.textContent = "编辑";
  saveBtn.onclick = () => editCard(cardId);
}

function editCard(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  const contentInput = cardRow.querySelector(".card-content-input");
  const correctInput = cardRow.querySelector(".correct-content-input");
  const originalDisplay = cardRow.querySelector(".card-content-display");
  const correctDisplay = cardRow.querySelector(".correct-content-display");

  // 切回编辑模式
  contentInput.style.display = "block";
  correctInput.style.display = "block";
  originalDisplay.style.display = "none";
  // 正确内容展示区保留显示（作为标注预览），进入编辑模式后始终渲染标注预览
  correctDisplay.classList.add("annotation-preview-live");
  renderAnnotations(cardId, correctDisplay.closest(".content-block"));

  // 显示标注工具栏
  const toolbar = cardRow.querySelector(".correct-toolbar");
  if (toolbar) toolbar.style.display = "flex";

  // 替换编辑按钮为保存按钮
  const editBtn = cardRow.querySelector(".btn-save-card");
  editBtn.textContent = "保存";
  editBtn.onclick = () => saveCard(cardId);
}

// ========== 翻译正确内容（调用 DeepSeek） ==========
async function translateCard(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  const translateBtn = cardRow.querySelector(".btn-translate");
  if (!translateBtn) return;
  const originalText = translateBtn.textContent;
  translateBtn.textContent = "翻译中...";
  translateBtn.disabled = true;

  try {
    const res = await fetch(`/api/cards/${cardId}/translate`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "翻译失败");
      return;
    }
    const data = await res.json();
    if (data.translation) {
      const translationInput = cardRow.querySelector(".card-translation-input");
      const translationDisplay = cardRow.querySelector(".card-translation-display");
      if (translationInput) translationInput.value = data.translation;
      if (translationDisplay) translationDisplay.textContent = data.translation;
      showToast("翻译完成，点击保存以持久化");
    } else {
      showToast("翻译结果为空");
    }
  } catch (e) {
    showToast("翻译失败");
  } finally {
    translateBtn.textContent = originalText;
    translateBtn.disabled = false;
  }
}

// 以单词为粒度的 diff（LCS 算法）
// 听写内容：对不上的词（包括多写和空缺位置）用红色背景，正确内容正常显示
// 分割时将标点符号也作为独立 token，避免 "abc." 和 "abc" 因标点不匹配
function diffWords(a, b) {
  const wordsA = a.split(/(\s+|[^\w\s])/).filter((t) => t !== "");
  const wordsB = b.split(/(\s+|[^\w\s])/).filter((t) => t !== "");
  const m = wordsA.length,
    n = wordsB.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (wordsA[i - 1] === wordsB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯，生成对齐序列
  let i = m,
    j = n;
  const aligned = [];
  while (i > 0 && j > 0) {
    if (wordsA[i - 1] === wordsB[j - 1]) {
      aligned.unshift({ type: "match", a: wordsA[i - 1], b: wordsB[j - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      aligned.unshift({ type: "a", a: wordsA[i - 1] });
      i--;
    } else {
      aligned.unshift({ type: "b", b: wordsB[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    aligned.unshift({ type: "a", a: wordsA[i - 1] });
    i--;
  }
  while (j > 0) {
    aligned.unshift({ type: "b", b: wordsB[j - 1] });
    j--;
  }

  // 合并连续的非 match 项，让单词尽量连在一起
  // 关键：单词之间的空格虽然是 match，但应该包含在 diff 组中，使红色背景连续
  const merged = [];
  let k = 0;
  while (k < aligned.length) {
    const item = aligned[k];
    if (item.type === "match" && !/^\s+$/.test(item.a || "")) {
      // 非空白 match，作为分隔
      merged.push(item);
      k++;
    } else {
      // 收集连续项：非 match 项 + 空白 match 项
      const group = [];
      let next = k;
      while (next < aligned.length) {
        const cur = aligned[next];
        if (cur.type === "match" && !/^\s+$/.test(cur.a || "")) {
          // 非空白 match，结束组
          break;
        }
        group.push(cur);
        next++;
      }
      if (group.length > 0 && group.some((g) => g.type !== "match")) {
        merged.push({ type: "diff", group });
      } else {
        // 全是空白 match
        group.forEach((g) => merged.push(g));
      }
      k = next;
    }
  }

  // 生成两边展示
  const originalParts = [];
  const correctParts = [];
  for (const item of merged) {
    if (item.type === "match") {
      originalParts.push(escapeHtml(item.a));
      correctParts.push(escapeHtml(item.b));
    } else if (item.type === "diff") {
      // 收集这个 diff 组中的所有内容（包括空白 match）
      const aWords = item.group.map((g) => g.a || "");
      const bWords = item.group.map((g) => g.b || "");
      const aNonSpace = aWords.filter((w) => !/^\s*$/.test(w));
      const bNonSpace = bWords.filter((w) => !/^\s*$/.test(w));
      const aCount = aNonSpace.length;
      const bCount = bNonSpace.length;

      // 听写侧：所有内容 + 空占位放在一个 span 中，背景融合为一笔
      let aHtml = aWords.map(escapeHtml).join("");
      if (aCount < bCount) {
        for (let x = 0; x < bCount - aCount; x++) aHtml += "&nbsp;";
      }
      originalParts.push(`<span class="compare-wrong">${aHtml}</span>`);

      // 正确侧：正常显示，补白色空占位
      let bHtml = bWords.map(escapeHtml).join("");
      if (bCount < aCount) {
        for (let x = 0; x < aCount - bCount; x++) {
          bHtml += `<span class="compare-empty">&nbsp;</span>`;
        }
      }
      correctParts.push(bHtml);
    }
  }

  return { original: originalParts.join(""), correct: correctParts.join("") };
}

function escapeHtml(s) {
  if (s === " ") return "&nbsp;";
  if (s === "\n") return "<br>";
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

// ========== 文本标注 ==========
// 颜色调色板（Notion 风格）
const FONT_COLORS = [
  "#e65100",
  "#2e7d32",
  "#0d47a1",
  "#c62828",
  "#6a1b9a",
  "#f57f17",
];
const BG_COLORS = [
  "#fff3e0",
  "#e8f5e9",
  "#e3f2fd",
  "#fce4ec",
  "#f3e5f5",
  "#fffde7",
];
const LIAISON_COLOR = "#1976d2"; // 连读-蓝
const WEAK_COLOR = "#7b1fa2"; // 弱读-紫
const BURST_COLOR = "#e64a19"; // 爆破-橙红

// Notion 风格颜色选择面板（字体行 + 背景行）
function showColorPicker() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "inline-modal-overlay";
    const fontDots = FONT_COLORS.map(
      (c) =>
        `<span class="color-dot" data-color="${c}" data-kind="font" style="background:${c}"></span>`,
    ).join("");
    const bgDots = BG_COLORS.map(
      (c) =>
        `<span class="color-dot" data-color="${c}" data-kind="bg" style="background:${c}"></span>`,
    ).join("");
    // 还原圆点：字体=黑色（默认），背景=透明（默认）
    const fontResetDot = `<span class="color-dot color-dot-reset" data-color="#000000" data-kind="font" style="background:#000000" title="还原字体为黑色"></span>`;
    const bgResetDot = `<span class="color-dot color-dot-reset" data-color="transparent" data-kind="bg" style="background:#ffffff" title="清除背景颜色"></span>`;
    overlay.innerHTML = `
      <div class="inline-modal color-picker-modal">
        <div class="color-picker-row-notion">
          <span class="color-picker-label">字体</span>
          <div class="color-dots">${fontDots}<span class="color-dot-divider"></span>${fontResetDot}</div>
        </div>
        <div class="color-picker-row-notion">
          <span class="color-picker-label">背景</span>
          <div class="color-dots">${bgDots}<span class="color-dot-divider"></span>${bgResetDot}</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelectorAll(".color-dot").forEach((dot) => {
      dot.onclick = () =>
        close({ kind: dot.dataset.kind, color: dot.dataset.color });
    });
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null);
    };
  });
}

async function applyAnnotation(btn, type) {
  const block = btn.closest(".content-block");
  const textarea = block.querySelector(".correct-content-input");
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  if (start === end) {
    showToast("请先选中文本");
    return;
  }

  const cardId = block.dataset.cardId;
  let value = null;
  let annType = type;

  if (type === "color") {
    // 颜色按钮：弹出两行选择器（字体+背景）
    const result = await showColorPicker();
    if (!result) return;
    if (result.kind === "font") {
      annType = "font_color";
      value = result.color;
    } else {
      annType = "bg_color";
      value = result.color;
    }
  }

  fetch(`/api/cards/${cardId}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      field: "correct_content",
      start_offset: start,
      end_offset: end,
      annotation_type: annType,
      annotation_value: value,
    }),
  }).then((res) => {
    if (res.ok) {
      return res.json().then((data) => {
        showToast(data.reset ? "已还原颜色" : "标注已保存");
        showAnnotationPreview(cardId, block);
      });
    } else {
      showToast("保存失败");
    }
  });
}

// 删除单个标注（连读/弱读/爆破的×按钮）
async function removeAnnotation(annId, cardId, el) {
  await fetch(`/api/annotations/${annId}`, { method: "DELETE" });
  // 从触发元素向上找到 content-block
  const block = el.closest(".content-block");
  if (block) {
    showAnnotationPreview(cardId, block);
  }
}

// 实时预览标注效果（编辑模式下也显示）
function showAnnotationPreview(cardId, block) {
  const display = block.querySelector(".correct-content-display");
  if (!display) return;
  display.style.display = "block";
  display.classList.add("annotation-preview-live");
  renderAnnotations(cardId, block);
}

// 渲染标注到展示模式
function renderAnnotations(cardId, block) {
  const display = block.querySelector(".correct-content-display");
  const textarea = block.querySelector(".correct-content-input");
  if (!display || !textarea) return;

  // 判断是否在编辑模式（预览区）
  const isEditing = display.classList.contains("annotation-preview-live");

  fetch(`/api/cards/${cardId}/annotations`)
    .then((res) => res.json())
    .then((data) => {
      const text = textarea.value;
      const annotations = data.annotations || [];
      if (annotations.length === 0) {
        display.innerHTML = "";
        // 如果是预览模式且有标注被清空，隐藏预览区
        if (display.classList.contains("annotation-preview-live")) {
          display.style.display = "none";
        }
        return;
      }

      // 按位置排序
      annotations.sort((a, b) => a.start_offset - b.start_offset);

      // 将文本按标注分段
      const segments = [];
      const boundaries = new Set([0, text.length]);
      for (const ann of annotations) {
        boundaries.add(ann.start_offset);
        boundaries.add(ann.end_offset);
      }
      const sortedBounds = [...boundaries].sort((a, b) => a - b);

      for (let i = 0; i < sortedBounds.length - 1; i++) {
        const segStart = sortedBounds[i];
        const segEnd = sortedBounds[i + 1];
        if (segStart >= segEnd) continue;
        const segText = text.slice(segStart, segEnd);
        const segAnns = annotations.filter(
          (a) => a.start_offset <= segStart && a.end_offset >= segEnd,
        );
        segments.push({ text: segText, annotations: segAnns });
      }

      // 生成 HTML
      // 跟踪已显示标签的语音标注，避免被颜色标注边界拆分后重复显示
      const labeledAnnIds = new Set();
      const htmlParts = [];
      for (const seg of segments) {
        const escaped = escapeHtml(seg.text);
        if (seg.annotations.length === 0) {
          htmlParts.push(escaped);
          continue;
        }

        // 分离颜色标注和语音标注
        const colorAnns = seg.annotations.filter(
          (a) =>
            a.annotation_type === "font_color" ||
            a.annotation_type === "bg_color",
        );
        const phoneticAnns = seg.annotations.filter(
          (a) =>
            a.annotation_type === "liaison" ||
            a.annotation_type === "weak" ||
            a.annotation_type === "burst",
        );

        // 先应用颜色标注（内层）
        let wrapped = escaped;
        for (const ann of colorAnns) {
          const val = ann.annotation_value || "";
          if (ann.annotation_type === "font_color") {
            wrapped =
              val !== "#000000"
                ? `<span style="color:${val};">${wrapped}</span>`
                : wrapped;
          } else if (ann.annotation_type === "bg_color") {
            wrapped =
              val && val !== "transparent"
                ? `<span style="background-color:${val};">${wrapped}</span>`
                : wrapped;
          }
        }

        // 再应用语音标注：每个标注只显示一次标签（首次出现的段）
        if (phoneticAnns.length > 0) {
          const labelParts = [];
          let borderColor = "";
          for (const ann of phoneticAnns) {
            // 只在该标注首次出现的段显示标签
            const showLabel = !labeledAnnIds.has(ann.id);
            labeledAnnIds.add(ann.id);
            const removeBtn =
              isEditing && showLabel
                ? `<span class="ann-remove" onclick="event.stopPropagation(); removeAnnotation(${ann.id},${cardId},this)" title="删除">×</span>`
                : "";
            if (ann.annotation_type === "liaison") {
              if (showLabel)
                labelParts.push(
                  `<span style="color:${LIAISON_COLOR};">连${removeBtn}</span>`,
                );
              borderColor = borderColor || LIAISON_COLOR;
            } else if (ann.annotation_type === "weak") {
              if (showLabel)
                labelParts.push(
                  `<span style="color:${WEAK_COLOR};">弱${removeBtn}</span>`,
                );
              borderColor = borderColor || WEAK_COLOR;
            } else if (ann.annotation_type === "burst") {
              if (showLabel)
                labelParts.push(
                  `<span style="color:${BURST_COLOR};">爆${removeBtn}</span>`,
                );
              borderColor = borderColor || BURST_COLOR;
            }
          }
          const labelHtml =
            labelParts.length > 0
              ? `<span class="annotation-label">${labelParts.join(" ")}</span>`
              : "";
          wrapped = `<span class="annotation-mark"><span class="annotation-text" style="border-bottom:2px solid ${borderColor};">${wrapped}</span>${labelHtml}</span>`;
        }

        htmlParts.push(wrapped);
      }

      display.innerHTML = htmlParts.join("").replace(/\n/g, "<br>");
    });
}

// ========== 分析错误 ==========
async function toggleAnalysis(cardId, btn) {
  if (btn.disabled) return;
  if (!dictationId) {
    showToast("请先保存听写记录");
    return;
  }

  const res = await fetch(`/api/cards/${cardId}/analysis`, { method: "POST" });
  if (res.ok) {
    // 按钮失效
    btn.disabled = true;
    btn.classList.add("btn-disabled");
    window.location.reload();
  } else {
    showToast("创建分析卡片失败");
  }
}

async function deleteAnalysisCard(cardId) {
  if (
    !(await showInlineConfirm("确认删除该分析卡片？关联的生词将从此卡片移除。"))
  )
    return;
  const res = await fetch(`/api/cards/${cardId}/analysis`, {
    method: "DELETE",
  });
  if (res.ok) {
    window.location.reload();
  } else {
    showToast("删除失败");
  }
}

function highlightCard(cardId) {
  const row = document.getElementById(`card-row-${cardId}`);
  if (row) {
    row.scrollIntoView({ behavior: "smooth", block: "start" });
    row.classList.add("card-highlight");
    setTimeout(() => row.classList.remove("card-highlight"), 2000);
  }
}

async function addAnalysisRecord(cardId, category) {
  const analysisCard = document.querySelector(
    `.analysis-card[data-card-id="${cardId}"]`,
  );
  const analysisCardId = analysisCard?.dataset.analysisCardId;
  if (!analysisCardId) {
    showToast("分析卡片未找到");
    return;
  }

  // 使用内联输入框替代 prompt
  const content = await showInlineInput("请输入记录内容：");
  if (!content) return;

  const res = await fetch(`/api/analysis/${analysisCardId}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, content }),
  });

  if (res.ok) {
    window.location.reload();
  } else {
    showToast("添加失败");
  }
}

async function deleteAnalysisRecord(recordId) {
  if (!(await showInlineConfirm("确认删除？"))) return;
  const res = await fetch(`/api/analysis/records/${recordId}`, {
    method: "DELETE",
  });
  if (res.ok) {
    document.querySelector(`[data-id="${recordId}"]`)?.remove();
  } else {
    showToast("删除失败");
  }
}

// ========== 编辑分析记录 ==========
async function editAnalysisRecord(recordId, el) {
  const span = el.closest(".analysis-record").querySelector(".record-content");
  const oldContent = span.textContent.trim();

  const newContent = await showInlineInput("编辑记录内容：", oldContent);
  if (newContent === null || newContent === oldContent) return;

  const res = await fetch(`/api/analysis/records/${recordId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: newContent }),
  });

  if (res.ok) {
    span.textContent = newContent;
  } else {
    showToast("保存失败");
  }
}

// ========== 从分析添加生词 ==========
async function addVocabFromAnalysis(cardId, dictId, label) {
  const result = await showVocabForm({
    word: "",
    phonetic: "",
    translation: "",
    notes: "",
    labels: [label],
  });
  if (!result) return;

  const res = await fetch("/api/vocabulary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      word: result.word,
      phonetic: result.phonetic,
      translation: result.translation,
      notes: result.notes,
      labels: result.labels,
      category: label,
      source_dictation_id: dictId,
      source_card_id: cardId,
    }),
  });

  if (res.ok) {
    const data = await res.json();
    if (data.merged) {
      showToast("已合并到已有生词");
    }
    window.location.reload();
  } else {
    showToast("添加失败");
  }
}

// ========== 从分析卡片删除生词（仅移除该卡片该分类的来源） ==========
async function deleteVocabFromCard(vocabId, cardId, category) {
  if (!(await showInlineConfirm("确认从该卡片删除此生词？"))) return;
  const res = await fetch(`/api/vocabulary/${vocabId}/source`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card_id: cardId, category }),
  });
  if (res.ok) {
    window.location.reload();
  } else {
    showToast("删除失败");
  }
}

// ========== 编辑生词（分析卡片） ==========
async function editVocab(vocabId, cardId) {
  const item = document.querySelector(`.vocab-item[data-id="${vocabId}"]`);
  if (!item) return;
  const word = item.querySelector(".vocab-word").textContent.trim();
  const phoneticEl = item.querySelector(".vocab-phonetic");
  const phonetic = phoneticEl
    ? phoneticEl.textContent.replace(/^\//, "").replace(/\/$/, "").trim()
    : "";
  const translationEl = item.querySelector(".vocab-translation");
  const translation = translationEl ? translationEl.textContent.trim() : "";
  const notesEl = item.querySelector(".vocab-notes");
  const notes = notesEl ? notesEl.textContent.trim() : "";

  // 检查该单词在哪些分类中出现（同一单词可能在读不懂和听不懂都出现）
  const allItems = document.querySelectorAll(`.vocab-item[data-id="${vocabId}"]`);
  const labels = [];
  allItems.forEach((el) => {
    const section = el.closest(".analysis-section");
    if (section) {
      const h5 = section.querySelector("h5");
      if (h5 && h5.textContent.includes("读不懂") && !labels.includes("cannot_read"))
        labels.push("cannot_read");
      if (h5 && h5.textContent.includes("听不懂") && !labels.includes("cannot_understand"))
        labels.push("cannot_understand");
    }
  });

  const result = await showVocabForm({ word, phonetic, translation, notes, labels });
  if (!result) return;

  const res = await fetch(`/api/vocabulary/${vocabId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      word: result.word,
      phonetic: result.phonetic,
      translation: result.translation,
      notes: result.notes,
      labels: result.labels,
      card_id: cardId,
      categories: result.labels,
    }),
  });

  if (res.ok) {
    window.location.reload();
  } else {
    showToast("保存失败");
  }
}

// ========== 生词表单（添加/编辑共用，分类由上下文决定） ==========
function showVocabForm(
  defaults = {
    word: "",
    phonetic: "",
    translation: "",
    notes: "",
    labels: [],
  },
) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "inline-modal-overlay";
    overlay.innerHTML = `
      <div class="inline-modal">
        <p class="inline-modal-message">生词信息</p>
        <div class="vocab-form">
          <div class="vocab-form-word-row">
            <input type="text" class="inline-modal-input vocab-form-word" placeholder="单词" value="${defaults.word}" />
            <button class="btn-secondary btn-small btn-lookup" type="button">查询</button>
          </div>
          <input type="text" class="inline-modal-input vocab-form-phonetic" placeholder="音标（可留空）" value="${defaults.phonetic}" />
          <input type="text" class="inline-modal-input vocab-form-translation" placeholder="翻译（可留空）" value="${defaults.translation}" />
          <textarea class="inline-modal-input vocab-form-notes" placeholder="备注（可留空）" rows="2">${defaults.notes}</textarea>
          <div class="vocab-form-hint" style="display:none;"></div>
        </div>
        <div class="inline-modal-buttons">
          <button class="btn-secondary btn-small inline-cancel">取消</button>
          <button class="btn-primary btn-small inline-ok">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const wordInput = overlay.querySelector(".vocab-form-word");
    const phoneticInput = overlay.querySelector(".vocab-form-phonetic");
    const translationInput = overlay.querySelector(".vocab-form-translation");
    const notesInput = overlay.querySelector(".vocab-form-notes");
    const hintEl = overlay.querySelector(".vocab-form-hint");
    const lookupBtn = overlay.querySelector(".btn-lookup");
    wordInput.focus();
    wordInput.select();

    // 单词失焦时搜索去重
    wordInput.addEventListener("blur", async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      try {
        const searchRes = await fetch(
          `/api/vocabulary/search?word=${encodeURIComponent(word)}`,
        );
        const searchData = await searchRes.json();
        if (searchData.found) {
          phoneticInput.value = searchData.phonetic;
          translationInput.value = searchData.translation;
          if (searchData.notes) notesInput.value = searchData.notes;
          hintEl.textContent = `已找到已有生词"${word}"，已自动填充`;
          hintEl.style.display = "block";
        }
      } catch (e) {
        // 忽略
      }
    });

    // 查询按钮：调用 DeepSeek 获取音标和翻译
    lookupBtn.onclick = async () => {
      const word = wordInput.value.trim();
      if (!word) {
        showToast("请先输入单词");
        return;
      }
      hintEl.textContent = "正在查询音标和翻译...";
      hintEl.style.display = "block";
      try {
        const lookupRes = await fetch(
          `/api/vocabulary/lookup?word=${encodeURIComponent(word)}`,
        );
        const lookupData = await lookupRes.json();
        if (lookupData.phonetic) phoneticInput.value = lookupData.phonetic;
        if (lookupData.translation)
          translationInput.value = lookupData.translation;
        hintEl.style.display = "none";
      } catch (e) {
        hintEl.textContent = "查询失败";
      }
    };

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    const submit = () => {
      const word = wordInput.value.trim();
      if (!word) {
        showToast("请输入单词");
        return;
      }
      close({
        word,
        phonetic: phoneticInput.value.trim(),
        translation: translationInput.value.trim(),
        notes: notesInput.value.trim(),
        labels: defaults.labels || [],
      });
    };

    overlay.querySelector(".inline-ok").onclick = submit;
    overlay.querySelector(".inline-cancel").onclick = () => close(null);
    overlay.querySelectorAll(".vocab-form input").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) submit();
        if (e.key === "Escape") close(null);
      });
    });
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null);
    };
  });
}

// ========== 内联输入框（替代 prompt） ==========
function showInlineInput(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "inline-modal-overlay";
    overlay.innerHTML = `
      <div class="inline-modal">
        <p class="inline-modal-message">${message}</p>
        <input type="text" class="inline-modal-input" value="${defaultValue}" />
        <div class="inline-modal-buttons">
          <button class="btn-secondary btn-small inline-cancel">取消</button>
          <button class="btn-primary btn-small inline-ok">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector(".inline-modal-input");
    input.focus();
    input.select();

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector(".inline-ok").onclick = () => close(input.value);
    overlay.querySelector(".inline-cancel").onclick = () => close(null);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) close(input.value);
      if (e.key === "Escape") close(null);
    });
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null);
    };
  });
}

// ========== 内联确认框（替代 confirm） ==========
function showInlineConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "inline-modal-overlay";
    overlay.innerHTML = `
      <div class="inline-modal">
        <p class="inline-modal-message">${message}</p>
        <div class="inline-modal-buttons">
          <button class="btn-secondary btn-small inline-cancel">取消</button>
          <button class="btn-primary btn-small inline-ok">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector(".inline-ok").onclick = () => close(true);
    overlay.querySelector(".inline-cancel").onclick = () => close(false);
    overlay.onclick = (e) => {
      if (e.target === overlay) close(false);
    };
  });
}

// ========== 工具函数 ==========
function showToast(msg) {
  const toast = document.createElement("div");
  toast.textContent = msg;
  toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.8); color: white; padding: 10px 20px;
        border-radius: 8px; font-size: 14px; z-index: 9999;
    `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ========== 初始化：有内容的卡片默认展示模式 ==========
document.querySelectorAll(".card-row").forEach((cardRow) => {
  const contentInput = cardRow.querySelector(".card-content-input");
  const correctInput = cardRow.querySelector(".correct-content-input");
  if (!contentInput || !correctInput) return;

  const content = contentInput.value;
  const correctContent = correctInput.value;

  // 有内容才切换到展示模式
  if (content.trim() || correctContent.trim()) {
    const originalDisplay = cardRow.querySelector(".card-content-display");
    const correctDisplay = cardRow.querySelector(".correct-content-display");

    const diffResult = diffWords(content, correctContent);
    originalDisplay.innerHTML = diffResult.original;
    correctDisplay.innerHTML = diffResult.correct;

    contentInput.style.display = "none";
    correctInput.style.display = "none";
    originalDisplay.style.display = "block";
    correctDisplay.style.display = "block";

    // 隐藏标注工具栏（展示模式下不可用）
    const toolbar = cardRow.querySelector(".correct-toolbar");
    if (toolbar) toolbar.style.display = "none";

    // 渲染标注到正确内容展示区
    const blocks = cardRow.querySelectorAll(".content-block");
    blocks.forEach((block) => {
      const cardId = block.dataset.cardId;
      const hasCorrectDisplay = block.querySelector(".correct-content-display");
      if (cardId && hasCorrectDisplay) {
        renderAnnotations(cardId, block);
      }
    });

    const saveBtn = cardRow.querySelector(".btn-save-card");
    if (saveBtn) {
      saveBtn.textContent = "编辑";
      saveBtn.onclick = () => editCard(cardRow.dataset.cardId);
    }
  }
});

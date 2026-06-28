// 详情页脚本：听写卡片、改正、分析、标注

const container = document.querySelector(".detail-container");
const dictationId = container?.dataset.dictationId || null;

// ========== 移动端检测 ==========
function isMobile() {
  return window.innerWidth <= 768;
}

// ========== 移动端覆盖层管理 ==========
function openMobileOverlay(rightCards, title, closeCallback) {
  if (!rightCards) return;
  // 移除已有的覆盖层头部
  rightCards
    .querySelectorAll(".mobile-overlay-header")
    .forEach((el) => el.remove());
  // 插入新的覆盖层头部
  const header = document.createElement("div");
  header.className = "mobile-overlay-header";
  header.innerHTML = `
    <span class="mobile-overlay-title">${title}</span>
    <button class="mobile-overlay-close" title="关闭">×</button>
  `;
  header.querySelector(".mobile-overlay-close").onclick = () => {
    closeCallback();
  };
  rightCards.insertBefore(header, rightCards.firstChild);
  rightCards.classList.add("mobile-open");
}

function closeMobileOverlay(rightCards) {
  if (!rightCards) return;
  rightCards.classList.remove("mobile-open");
  // 移除覆盖层头部
  rightCards
    .querySelectorAll(".mobile-overlay-header")
    .forEach((el) => el.remove());
}

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

// ========== 卡片复制/剪切/粘贴 ==========
async function copyCard(cardId) {
  const res = await fetch(`/api/cards/${cardId}/copy`, { method: "POST" });
  if (res.ok) {
    const data = await res.json();
    showToast("已复制" + (data.word ? `："${data.word}..."` : ""));
    updatePasteButton();
  } else {
    showToast("复制失败");
  }
}

async function cutCard(cardId) {
  if (!(await showInlineConfirm("确认剪切该卡片？"))) return;
  const res = await fetch(`/api/cards/${cardId}/cut`, { method: "POST" });
  if (res.ok) {
    const data = await res.json();
    showToast("已剪切" + (data.word ? `："${data.word}..."` : ""));
    document.querySelector(`.card-row[data-card-id="${cardId}"]`)?.remove();
    updatePasteButton();
  } else {
    showToast("剪切失败");
  }
}

async function pasteCard() {
  if (!dictationId) {
    showToast("请先保存听写记录");
    return;
  }
  const res = await fetch(`/api/dictations/${dictationId}/paste`, {
    method: "POST",
  });
  if (res.ok) {
    showToast("粘贴成功");
    window.location.reload();
  } else {
    const err = await res.json().catch(() => ({}));
    showToast(err.detail || "粘贴失败");
  }
}

async function updatePasteButton() {
  const btn = document.querySelector(".btn-paste");
  if (!btn) return;
  try {
    const res = await fetch("/api/clipboard");
    const data = await res.json();
    if (data.empty) {
      btn.style.display = "none";
    } else {
      btn.style.display = "inline-block";
      btn.textContent = `粘贴卡片${data.preview ? `（${data.preview}...）` : ""}`;
    }
  } catch (e) {
    // 忽略
  }
}

// 页面加载时检查剪贴板状态
document.addEventListener("DOMContentLoaded", updatePasteButton);

// ========== 左侧听写卡片跟随滚动 ==========
function initStickyLeftCards() {
  // 移动端不需要 sticky 行为
  if (isMobile()) return;
  function update() {
    document.querySelectorAll(".card-row").forEach((row) => {
      const dictCard = row.querySelector(".dict-card");
      const rightCards = row.querySelector(".right-cards");
      if (!dictCard || !rightCards) return;

      const cardHeight = dictCard.offsetHeight;
      const rightHeight = rightCards.offsetHeight;

      // 右列不比左列高，不需要 sticky
      if (rightHeight <= cardHeight) {
        dictCard.style.position = "";
        dictCard.style.top = "";
        return;
      }

      const viewportH = window.innerHeight;
      const offset = 10;

      // 卡片本身比视口高，固定在顶部即可
      if (cardHeight + offset * 2 >= viewportH) {
        dictCard.style.position = "sticky";
        dictCard.style.top = offset + "px";
        return;
      }

      const rowRect = row.getBoundingClientRect();
      const rowTop = rowRect.top;
      const rowBottom = rowRect.bottom;

      // 行完全在视口外，不处理
      if (rowBottom < 0 || rowTop > viewportH) return;

      // 行顶部还在视口内（没滚出顶部），不需要 sticky
      if (rowTop > offset) {
        dictCard.style.position = "";
        dictCard.style.top = "";
        return;
      }

      // 行顶部已滚出视口顶部，固定在顶部
      dictCard.style.position = "sticky";
      dictCard.style.top = offset + "px";
    });
  }

  let ticking = false;
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
      ticking = true;
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  document.addEventListener("DOMContentLoaded", update);
  update();
}

document.addEventListener("DOMContentLoaded", initStickyLeftCards);

// ========== 卡片拖拽排序 ==========
function initCardDragSort() {
  const container = document.getElementById("cards-container");
  if (!container) return;
  let draggedItem = null;

  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".card-row");
    if (!item) return;
    // 不从分析卡片/结构卡片内部发起拖拽
    if (
      e.target.closest(
        ".analysis-card, .structure-card, textarea, input, button",
      )
    ) {
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
    const afterElement = getCardDragAfterElement(
      container,
      draggedItem,
      e.clientY,
    );
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

// ========== 页面加载时初始化已显示的卡片 ==========
function initVisibleCards() {
  document.querySelectorAll(".card-row").forEach((cardRow) => {
    const analysisCard = cardRow.querySelector(".analysis-card");
    const analysisBtn = cardRow.querySelector(".btn-analysis");
    const structureCard = cardRow.querySelector(".structure-card");
    const structureBtn = cardRow.querySelector(".btn-toggle-extra");

    // 移动端：页面加载时隐藏右侧卡片，不自动弹出覆盖层
    if (isMobile()) {
      const rightCards = cardRow.querySelector(".right-cards");
      if (rightCards) rightCards.classList.remove("mobile-open");
      if (analysisCard && analysisCard.style.display !== "none") {
        analysisCard.style.display = "none";
        if (analysisBtn) analysisBtn.classList.remove("btn-disabled");
      }
      if (structureCard && structureCard.style.display !== "none") {
        structureCard.style.display = "none";
        if (structureBtn) {
          structureBtn.classList.remove("btn-disabled");
          structureBtn.disabled = false;
        }
      }
    } else {
      // PC端：有内容的卡片始终展开，忽略用户关闭状态
      // 分析卡片：如果 DOM 中存在分析卡片，说明有内容，强制展开
      if (analysisCard && analysisCard.style.display === "none") {
        analysisCard.style.display = "block";
        if (analysisBtn) analysisBtn.classList.add("btn-disabled");
      } else if (analysisCard && analysisBtn) {
        analysisBtn.classList.add("btn-disabled");
      }

      // 结构卡片：如果有翻译或分析内容，强制展开
      const translationInput = cardRow.querySelector(".card-translation-input");
      const analysisInput = cardRow.querySelector(".card-analysis-input");
      const hasStructureContent =
        (translationInput && translationInput.value.trim()) ||
        (analysisInput && analysisInput.value.trim());
      if (structureCard && hasStructureContent) {
        structureCard.style.display = "block";
        if (structureBtn) {
          structureBtn.classList.add("btn-disabled");
          structureBtn.disabled = true;
        }
        initStructureDisplayMode(cardRow);
      } else if (structureCard && structureCard.style.display !== "none") {
        // 无内容但已展开：初始化展示模式
        if (structureBtn) {
          structureBtn.classList.add("btn-disabled");
          structureBtn.disabled = true;
        }
      }
    }

    // 为听写内容和正确内容的 textarea 绑定 blur 自动保存
    const cardId2 = cardRow.dataset.cardId;
    const contentInput = cardRow.querySelector(".card-content-input");
    const correctInput = cardRow.querySelector(".correct-content-input");
    if (contentInput) {
      contentInput.addEventListener("blur", () => autoSaveCard(cardId2));
    }
    if (correctInput) {
      correctInput.addEventListener("blur", () => autoSaveCard(cardId2));
    }
  });
}
document.addEventListener("DOMContentLoaded", initVisibleCards);

// ========== 卡片自动保存（blur 时触发） ==========
let autoSaveTimers = {};
function autoSaveCard(cardId) {
  // 延迟 300ms 执行，避免连续 blur（如从 content 跳到 correct）触发多次
  clearTimeout(autoSaveTimers[cardId]);
  autoSaveTimers[cardId] = setTimeout(async () => {
    const cardRow = document.querySelector(
      `.card-row[data-card-id="${cardId}"]`,
    );
    if (!cardRow) return;
    const contentInput = cardRow.querySelector(".card-content-input");
    const correctInput = cardRow.querySelector(".correct-content-input");
    if (!contentInput || !correctInput) return;
    // 只有在编辑模式（textarea 可见）时才自动保存
    if (contentInput.style.display === "none") return;
    const content = contentInput.value;
    const correctContent = correctInput.value;
    try {
      await fetch(`/api/cards/${cardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, correct_content: correctContent }),
      });
    } catch (e) {
      // 静默失败
    }
  }, 300);
}

// ========== 结构卡片自动保存（blur 时触发） ==========
let structureSaveTimers = {};
function autoSaveStructure(cardId) {
  // 延迟 300ms 执行，避免连续 blur（如从翻译跳到分析）触发多次
  clearTimeout(structureSaveTimers[cardId]);
  structureSaveTimers[cardId] = setTimeout(async () => {
    const cardRow = document.querySelector(
      `.card-row[data-card-id="${cardId}"]`,
    );
    if (!cardRow) return;
    const translationInput = cardRow.querySelector(".card-translation-input");
    const analysisInput = cardRow.querySelector(".card-analysis-input");
    if (!translationInput && !analysisInput) return;
    // 只有在编辑模式（输入框可见）时才自动保存
    if (translationInput && translationInput.style.display === "none") return;
    const translation = translationInput ? translationInput.value : "";
    const analysis = analysisInput ? analysisInput.value : "";
    try {
      await fetch(`/api/cards/${cardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translation, analysis }),
      });
    } catch (e) {
      // 静默失败
    }
  }, 300);
}

// ========== 结构卡片展开/收起 ==========
function toggleExtra(btn) {
  const cardRow = btn.closest(".card-row");
  if (!cardRow) return;
  const cardId = cardRow.dataset.cardId;
  const structureCard = cardRow.querySelector(".structure-card");
  const rightCards = cardRow.querySelector(".right-cards");
  if (!structureCard) return;

  // 切换显示/隐藏
  const isHidden = structureCard.style.display === "none";
  structureCard.style.display = isHidden ? "block" : "none";

  if (isHidden) {
    // 打开：按钮变灰
    btn.classList.add("btn-disabled");
    btn.disabled = true;
    // 移动端：弹出覆盖层
    if (isMobile() && rightCards) {
      openMobileOverlay(rightCards, "结构分析", () => closeStructure(cardId));
    }
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
  } else {
    // 关闭：恢复按钮
    btn.classList.remove("btn-disabled");
    btn.disabled = false;
    // 移动端：关闭覆盖层
    if (isMobile() && rightCards) closeMobileOverlay(rightCards);
  }
  // 保存可见性状态
  fetch(`/api/cards/${cardId}/visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structure_card_visible: isHidden ? 1 : 0 }),
  });
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
  // 移动端：关闭覆盖层
  const rightCards = cardRow.querySelector(".right-cards");
  if (isMobile() && rightCards) closeMobileOverlay(rightCards);
  // 保存可见性状态
  fetch(`/api/cards/${cardId}/visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structure_card_visible: 0 }),
  });
}

function initStructureEditMode(cardRow) {
  const translationInput = cardRow.querySelector(".card-translation-input");
  const analysisInput = cardRow.querySelector(".card-analysis-input");
  const translationDisplay = cardRow.querySelector(".card-translation-display");
  const analysisDisplay = cardRow.querySelector(".card-analysis-display");
  const translateBtn = cardRow.querySelector(".btn-translate");
  const saveBtn = cardRow.querySelector(".btn-save-structure");

  if (translationInput) {
    translationInput.style.display = "block";
    if (!translationInput.dataset.autoSaveBound) {
      translationInput.addEventListener("blur", () =>
        autoSaveStructure(cardRow.dataset.cardId),
      );
      translationInput.dataset.autoSaveBound = "true";
    }
  }
  if (analysisInput) {
    analysisInput.style.display = "block";
    if (!analysisInput.dataset.autoSaveBound) {
      analysisInput.addEventListener("blur", () =>
        autoSaveStructure(cardRow.dataset.cardId),
      );
      analysisInput.dataset.autoSaveBound = "true";
    }
  }
  if (translationDisplay) translationDisplay.style.display = "none";
  if (analysisDisplay) analysisDisplay.style.display = "none";
  if (translateBtn) translateBtn.style.display = "";
  if (saveBtn) {
    saveBtn.textContent = "保存";
    saveBtn.onclick = () => saveStructure(cardRow.dataset.cardId);
  }
  // 保存原始值用于取消
  if (translationInput)
    translationInput.dataset.originalValue = translationInput.value;
  if (analysisInput) analysisInput.dataset.originalValue = analysisInput.value;
  // 显示取消按钮
  const cancelBtn = cardRow.querySelector(".btn-cancel-structure");
  if (cancelBtn) cancelBtn.style.display = "";
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
  // 隐藏取消按钮
  const cancelBtn = cardRow.querySelector(".btn-cancel-structure");
  if (cancelBtn) cancelBtn.style.display = "none";
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

async function cancelStructure(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  const translationInput = cardRow.querySelector(".card-translation-input");
  const analysisInput = cardRow.querySelector(".card-analysis-input");
  const translation = translationInput
    ? translationInput.dataset.originalValue || ""
    : "";
  const analysis = analysisInput
    ? analysisInput.dataset.originalValue || ""
    : "";
  // 恢复 textarea 值
  if (translationInput) translationInput.value = translation;
  if (analysisInput) analysisInput.value = analysis;
  // autoSave 可能已修改服务器，用原始值覆盖
  await fetch(`/api/cards/${cardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ translation, analysis }),
  });
  initStructureDisplayMode(cardRow);
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

  // 隐藏取消按钮
  const cancelBtn = cardRow.querySelector(".btn-cancel-card");
  if (cancelBtn) cancelBtn.style.display = "none";

  // 保存成功后检查是否需要复习
  if (typeof checkReviewAfterSave === "function") checkReviewAfterSave();
}

function cancelCard(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  const contentInput = cardRow.querySelector(".card-content-input");
  const correctInput = cardRow.querySelector(".correct-content-input");
  // 恢复原始值
  if (contentInput.dataset.originalValue !== undefined) {
    contentInput.value = contentInput.dataset.originalValue;
  }
  if (correctInput.dataset.originalValue !== undefined) {
    correctInput.value = correctInput.dataset.originalValue;
  }
  // 切换到展示模式（不保存到服务器）
  const originalDisplay = cardRow.querySelector(".card-content-display");
  const correctDisplay = cardRow.querySelector(".correct-content-display");
  const content = contentInput.value;
  const correctContent = correctInput.value;
  const diffResult = diffWords(content, correctContent);
  originalDisplay.innerHTML = diffResult.original;
  correctDisplay.innerHTML = diffResult.correct;
  correctDisplay.classList.remove("annotation-preview-live");
  const blocks = cardRow.querySelectorAll(".content-block");
  blocks.forEach((block) => {
    const cid = block.dataset.cardId;
    if (cid && block.querySelector(".correct-content-display")) {
      renderAnnotations(cid, block);
    }
  });
  contentInput.style.display = "none";
  correctInput.style.display = "none";
  originalDisplay.style.display = "block";
  correctDisplay.style.display = "block";
  const toolbar = cardRow.querySelector(".correct-toolbar");
  if (toolbar) toolbar.style.display = "none";
  const saveBtn = cardRow.querySelector(".btn-save-card");
  saveBtn.textContent = "编辑";
  saveBtn.onclick = () => editCard(cardId);
  const cancelBtn = cardRow.querySelector(".btn-cancel-card");
  if (cancelBtn) cancelBtn.style.display = "none";
}

function editCard(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  const contentInput = cardRow.querySelector(".card-content-input");
  const correctInput = cardRow.querySelector(".correct-content-input");
  const originalDisplay = cardRow.querySelector(".card-content-display");
  const correctDisplay = cardRow.querySelector(".correct-content-display");

  // 保存原始值用于取消
  contentInput.dataset.originalValue = contentInput.value;
  correctInput.dataset.originalValue = correctInput.value;

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

  // 显示取消按钮
  const cancelBtn = cardRow.querySelector(".btn-cancel-card");
  if (cancelBtn) cancelBtn.style.display = "";
}

// ========== AI 分析连读/弱读（调用 DeepSeek） ==========
async function analyzePhonetics(btn, cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  const block = btn.closest(".content-block");
  const originalText = btn.textContent;
  btn.textContent = "分析中...";
  btn.disabled = true;

  try {
    const res = await fetch(`/api/cards/${cardId}/analyze-phonetics`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      handleDeepSeekError(res, err);
      return;
    }
    const data = await res.json();
    if (data.saved > 0) {
      showToast(`已标记 ${data.saved} 处（跳过 ${data.skipped} 处）`);
      // 刷新预览
      showAnnotationPreview(cardId, block);
    } else {
      showToast("未发现需要标注的连读/弱读");
    }
  } catch (e) {
    showToast("分析失败");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
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
    const res = await fetch(`/api/cards/${cardId}/translate`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      handleDeepSeekError(res, err);
      return;
    }
    const data = await res.json();
    if (data.translation) {
      const translationInput = cardRow.querySelector(".card-translation-input");
      const translationDisplay = cardRow.querySelector(
        ".card-translation-display",
      );
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

// 统一处理 DeepSeek 调用失败的提示
function handleDeepSeekError(res, err) {
  const detail = err.detail || "调用失败";
  if (res.status === 402 || err.balance_insufficient) {
    showToast(`余额不足：${detail}。请前往 DeepSeek 平台充值`);
  } else if (res.status === 400 || err.no_key) {
    showToast(`${detail}（点击右上角「API 设置」配置）`);
  } else if (res.status === 401) {
    showToast(`API Key 无效：${detail}`);
  } else {
    showToast(detail);
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
        // 根据正确侧缺失单词的实际长度补位，使空缺宽度匹配
        const missingWords = bNonSpace.slice(aCount);
        for (const w of missingWords) {
          // 每个缺失单词的长度 + 1 个空格间隔
          aHtml += "&nbsp;".repeat(Math.max(w.length, 1)) + "&nbsp;";
        }
      }
      originalParts.push(`<span class="compare-wrong">${aHtml}</span>`);

      // 正确侧：正常显示，补白色空占位
      let bHtml = bWords.map(escapeHtml).join("");
      if (bCount < aCount) {
        const missingWords = aNonSpace.slice(bCount);
        for (const w of missingWords) {
          bHtml += `<span class="compare-empty">${"&nbsp;".repeat(Math.max(w.length, 1))}&nbsp;</span>`;
        }
      }
      correctParts.push(bHtml);
    }
  }

  return { original: originalParts.join(""), correct: correctParts.join("") };
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n/g, "&nbsp;")
    .replace(/\r/g, "")
    .replace(/\n/g, "&nbsp;");
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
  const selectedText = textarea.value.slice(start, end);

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
      text_content: selectedText,
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

// 在文本中搜索 substring 的所有出现位置，返回最接近 originalOffset 的那个
function findNearestOccurrence(text, substring, originalOffset) {
  let bestIdx = -1;
  let bestDist = Infinity;
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(substring, searchFrom);
    if (idx === -1) break;
    const dist = Math.abs(idx - originalOffset);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
    searchFrom = idx + 1;
  }
  return bestIdx;
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
        // 非编辑模式下不清空（保留 diffWords 的结果），仅编辑模式清空预览区
        if (display.classList.contains("annotation-preview-live")) {
          display.innerHTML = "";
          display.style.display = "none";
        }
        return;
      }

      // 使用 text_content 动态定位标注位置
      // 对每个标注，如果存了 text_content，就在当前文本中搜索最接近原始 offset 的出现位置
      const resolvedAnnotations = annotations.map((ann) => {
        if (ann.text_content && ann.text_content.length > 0) {
          // 在当前文本中搜索标注内容，找到最接近原始 offset 的出现位置
          const bestIdx = findNearestOccurrence(
            text,
            ann.text_content,
            ann.start_offset,
          );
          if (bestIdx !== -1) {
            return {
              ...ann,
              start_offset: bestIdx,
              end_offset: bestIdx + ann.text_content.length,
            };
          }
        }
        // 回退到原始 offset
        return ann;
      });

      // 按位置排序
      resolvedAnnotations.sort((a, b) => a.start_offset - b.start_offset);

      // 将文本按标注分段
      const segments = [];
      const boundaries = new Set([0, text.length]);
      for (const ann of resolvedAnnotations) {
        boundaries.add(ann.start_offset);
        boundaries.add(ann.end_offset);
      }
      const sortedBounds = [...boundaries].sort((a, b) => a - b);

      for (let i = 0; i < sortedBounds.length - 1; i++) {
        const segStart = sortedBounds[i];
        const segEnd = sortedBounds[i + 1];
        if (segStart >= segEnd) continue;
        const segText = text.slice(segStart, segEnd);
        const segAnns = resolvedAnnotations.filter(
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
          let primaryColor = "";
          let customRendered = false; // 是否已经自定义渲染（连读/弱读）

          for (const ann of phoneticAnns) {
            // 只在该标注首次出现的段显示标签
            const showLabel = !labeledAnnIds.has(ann.id);
            labeledAnnIds.add(ann.id);
            const removeBtn =
              isEditing && showLabel
                ? `<span class="ann-remove" onclick="event.stopPropagation(); removeAnnotation(${ann.id},${cardId},this)" title="删除">×</span>`
                : "";

            if (ann.annotation_type === "liaison") {
              primaryColor = primaryColor || LIAISON_COLOR;
              // 连读：如果选中文本是 "word1 (空格) word2" 模式，把空格替换为 //
              if (showLabel && !customRendered) {
                const originalText = seg.text;
                const m = originalText.match(/^(\S+?)\s+(\S+)$/);
                if (m) {
                  const newText = m[1] + "//" + m[2];
                  const escapedNew = escapeHtml(newText);
                  wrapped = `<span class="annotation-mark"><span class="annotation-text liaison-text" style="color:${LIAISON_COLOR};font-weight:600;">${escapedNew}</span>${removeBtn ? '<span class="annotation-label">' + removeBtn + "</span>" : ""}</span>`;
                  customRendered = true;
                  continue;
                }
              }
              if (showLabel) labelParts.push(removeBtn);
            } else if (ann.annotation_type === "weak") {
              primaryColor = primaryColor || WEAK_COLOR;
              if (showLabel && !customRendered) {
                // 弱读：在单词上画一条横线（删除线样式）
                const text = escapeHtml(seg.text);
                wrapped = `<span class="annotation-mark weak-strike"><span class="annotation-text" style="color:${WEAK_COLOR};text-decoration:line-through;text-decoration-thickness:2px;">${text}</span>${removeBtn ? '<span class="annotation-label">' + removeBtn + "</span>" : ""}</span>`;
                customRendered = true;
                continue;
              }
              if (showLabel) labelParts.push(removeBtn);
            } else if (ann.annotation_type === "burst") {
              primaryColor = primaryColor || BURST_COLOR;
              if (showLabel)
                labelParts.push(
                  `<span style="color:${BURST_COLOR};">爆${removeBtn}</span>`,
                );
            }
          }

          // 如果没有自定义渲染（连读/弱读），使用默认下划线
          if (!customRendered) {
            const labelHtml =
              labelParts.length > 0
                ? `<span class="annotation-label">${labelParts.join(" ")}</span>`
                : "";
            wrapped = `<span class="annotation-mark"><span class="annotation-text" style="border-bottom:2px solid ${primaryColor};">${wrapped}</span>${labelHtml}</span>`;
          }
        }

        htmlParts.push(wrapped);
      }

      display.innerHTML = htmlParts.join("");
    });
}

// ========== 错误分析 ==========
async function toggleAnalysis(cardId, btn) {
  if (!dictationId) {
    showToast("请先保存听写记录");
    return;
  }

  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  const existingCard = cardRow?.querySelector(".analysis-card");

  if (existingCard) {
    // 已存在：切换显示/隐藏
    const isHidden = existingCard.style.display === "none";
    existingCard.style.display = isHidden ? "block" : "none";
    if (isHidden) {
      btn.classList.add("btn-disabled");
      // 移动端：弹出覆盖层
      const rightCards = cardRow?.querySelector(".right-cards");
      if (isMobile() && rightCards) {
        openMobileOverlay(rightCards, "错误分析", () => closeAnalysis(cardId));
      }
    } else {
      btn.classList.remove("btn-disabled");
      // 移动端：关闭覆盖层
      const rightCards = cardRow?.querySelector(".right-cards");
      if (isMobile() && rightCards) closeMobileOverlay(rightCards);
    }
    // 保存可见性状态
    fetch(`/api/cards/${cardId}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis_card_visible: isHidden ? 1 : 0 }),
    });
    return;
  }

  // 不存在：创建（立即禁用按钮，防止重复点击）
  btn.classList.add("btn-disabled");
  const res = await fetch(`/api/cards/${cardId}/analysis`, { method: "POST" });
  if (res.ok) {
    const data = await res.json();
    // 动态插入空的分析卡片，避免整页刷新
    insertAnalysisCard(cardRow, cardId, data.id);
    // 移动端：弹出覆盖层
    const rightCards = cardRow?.querySelector(".right-cards");
    if (isMobile() && rightCards) {
      openMobileOverlay(rightCards, "错误分析", () => closeAnalysis(cardId));
    }
    // 保存可见性状态
    fetch(`/api/cards/${cardId}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis_card_visible: 1 }),
    });
  } else {
    btn.classList.remove("btn-disabled");
    showToast("创建分析卡片失败");
  }
}

// 动态插入空的分析卡片 DOM
function insertAnalysisCard(cardRow, cardId, analysisCardId) {
  const rightCards = cardRow.querySelector(".right-cards");
  if (!rightCards) return;
  const html = `
    <div class="analysis-card" data-card-id="${cardId}" data-analysis-card-id="${analysisCardId}" style="display: block;">
      <div class="analysis-card-header">
        <a href="#card-row-${cardId}" class="analysis-source-link" onclick="highlightCard(${cardId})">
          ← 来自听写卡片
        </a>
        <button class="btn-icon btn-delete" onclick="closeAnalysis(${cardId})" title="关闭分析卡片">×</button>
      </div>
      <div class="analysis-sections">
        <div class="analysis-section">
          <h5>读不懂</h5>
          <div class="vocab-list" data-card-id="${cardId}"></div>
          <button class="btn-secondary btn-small" onclick="addVocabFromAnalysis(${cardId}, ${dictationId}, 'cannot_read')">+ 添加</button>
        </div>
        <div class="analysis-section">
          <h5>听不懂（音标/重音）</h5>
          <div class="vocab-list" data-card-id="${cardId}"></div>
          <button class="btn-secondary btn-small" onclick="addVocabFromAnalysis(${cardId}, ${dictationId}, 'cannot_understand')">+ 添加</button>
        </div>
        <div class="analysis-section">
          <h5>听不到（连读/弱读）</h5>
          <div class="analysis-records" data-category="cannot_hear" data-card-id="${cardId}"></div>
          <button class="btn-secondary btn-small" onclick="addAnalysisRecord(${cardId}, 'cannot_hear')">+ 添加</button>
        </div>
      </div>
    </div>
  `;
  // 插入到结构卡片之前
  const structureCard = rightCards.querySelector(".structure-card");
  if (structureCard) {
    structureCard.insertAdjacentHTML("beforebegin", html);
  } else {
    rightCards.insertAdjacentHTML("beforeend", html);
  }
}

function closeAnalysis(cardId) {
  const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
  if (!cardRow) return;
  const analysisCard = cardRow.querySelector(".analysis-card");
  if (analysisCard) analysisCard.style.display = "none";
  // 恢复"错误分析"按钮
  const btn = cardRow.querySelector(".btn-analysis");
  if (btn) btn.classList.remove("btn-disabled");
  // 移动端：关闭覆盖层
  const rightCards = cardRow.querySelector(".right-cards");
  if (isMobile() && rightCards) closeMobileOverlay(rightCards);
  // 保存可见性状态
  fetch(`/api/cards/${cardId}/visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysis_card_visible: 0 }),
  });
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
    pos: "",
    past_tense: "",
    past_participle: "",
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
      pos: result.pos,
      past_tense: result.past_tense,
      past_participle: result.past_participle,
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
  const posEl = item.querySelector(".vocab-pos");
  const pos = posEl ? posEl.textContent.trim() : "";
  const pastTenseEl = item.querySelector(".vocab-past-tense");
  const pastTense = pastTenseEl
    ? pastTenseEl.textContent.replace(/^过去式：/, "").trim()
    : "";
  const pastParticipleEl = item.querySelector(".vocab-past-participle");
  const pastParticiple = pastParticipleEl
    ? pastParticipleEl.textContent.replace(/^过去分词：/, "").trim()
    : "";
  const translationEl = item.querySelector(".vocab-translation");
  const translation = translationEl ? translationEl.textContent.trim() : "";
  const notesEl = item.querySelector(".vocab-notes");
  const notes = notesEl ? notesEl.textContent.trim() : "";

  // 检查该单词在哪些分类中出现（同一单词可能在读不懂和听不懂都出现）
  const allItems = document.querySelectorAll(
    `.vocab-item[data-id="${vocabId}"]`,
  );
  const labels = [];
  allItems.forEach((el) => {
    const section = el.closest(".analysis-section");
    if (section) {
      const h5 = section.querySelector("h5");
      if (
        h5 &&
        h5.textContent.includes("读不懂") &&
        !labels.includes("cannot_read")
      )
        labels.push("cannot_read");
      if (
        h5 &&
        h5.textContent.includes("听不懂") &&
        !labels.includes("cannot_understand")
      )
        labels.push("cannot_understand");
    }
  });

  const result = await showVocabForm({
    word,
    phonetic,
    pos,
    past_tense: pastTense,
    past_participle: pastParticiple,
    translation,
    notes,
    labels,
  });
  if (!result) return;

  const res = await fetch(`/api/vocabulary/${vocabId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      word: result.word,
      phonetic: result.phonetic,
      pos: result.pos,
      past_tense: result.past_tense,
      past_participle: result.past_participle,
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
    pos: "",
    past_tense: "",
    past_participle: "",
    translation: "",
    notes: "",
    labels: [],
  },
) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "inline-modal-overlay";
    const readChecked = defaults.labels.includes("cannot_read")
      ? "checked"
      : "";
    const understandChecked = defaults.labels.includes("cannot_understand")
      ? "checked"
      : "";
    overlay.innerHTML = `
      <div class="inline-modal">
        <p class="inline-modal-message">生词信息</p>
        <div class="vocab-form">
          <div class="vocab-form-word-row">
            <input type="text" class="inline-modal-input vocab-form-word" placeholder="单词" value="${defaults.word}" />
            <button class="btn-secondary btn-small btn-lookup" type="button">查询</button>
          </div>
          <input type="text" class="inline-modal-input vocab-form-phonetic" placeholder="音标（可留空）" value="${defaults.phonetic}" />
          <input type="text" class="inline-modal-input vocab-form-pos" placeholder="词性（如 verb/noun/adj，可留空）" value="${defaults.pos}" />
          <div class="vocab-form-tense-row">
            <input type="text" class="inline-modal-input vocab-form-past-tense" placeholder="过去式（可留空）" value="${defaults.past_tense}" />
            <input type="text" class="inline-modal-input vocab-form-past-participle" placeholder="过去分词（可留空）" value="${defaults.past_participle}" />
          </div>
          <textarea class="inline-modal-input vocab-form-translation" placeholder="翻译（可留空，多个含义用分号分隔）" rows="2">${defaults.translation}</textarea>
          <textarea class="inline-modal-input vocab-form-notes" placeholder="备注（可留空）" rows="2">${defaults.notes}</textarea>
          <div class="vocab-form-categories">
            <label class="vocab-category-label"><input type="checkbox" class="vocab-cat-read" ${readChecked} /> 看不懂</label>
            <label class="vocab-category-label"><input type="checkbox" class="vocab-cat-understand" ${understandChecked} /> 听不懂</label>
          </div>
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
    const posInput = overlay.querySelector(".vocab-form-pos");
    const pastTenseInput = overlay.querySelector(".vocab-form-past-tense");
    const pastParticipleInput = overlay.querySelector(
      ".vocab-form-past-participle",
    );
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
          posInput.value = searchData.pos;
          pastTenseInput.value = searchData.past_tense;
          pastParticipleInput.value = searchData.past_participle;
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
        if (!lookupRes.ok) {
          const err = await lookupRes.json().catch(() => ({}));
          handleDeepSeekError(lookupRes, err);
          hintEl.style.display = "none";
          return;
        }
        const lookupData = await lookupRes.json();
        if (lookupData.phonetic) phoneticInput.value = lookupData.phonetic;
        if (lookupData.pos) posInput.value = lookupData.pos;
        if (lookupData.past_tense) pastTenseInput.value = lookupData.past_tense;
        if (lookupData.past_participle)
          pastParticipleInput.value = lookupData.past_participle;
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
      // 读取分类选择
      const labels = [];
      if (overlay.querySelector(".vocab-cat-read")?.checked)
        labels.push("cannot_read");
      if (overlay.querySelector(".vocab-cat-understand")?.checked)
        labels.push("cannot_understand");
      close({
        word,
        phonetic: phoneticInput.value.trim(),
        pos: posInput.value.trim(),
        past_tense: pastTenseInput.value.trim(),
        past_participle: pastParticipleInput.value.trim(),
        translation: translationInput.value.trim(),
        notes: notesInput.value.trim(),
        labels,
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

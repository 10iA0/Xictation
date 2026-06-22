// 主脚本：通用功能

// ========== 侧边栏折叠（全局状态持久化） ==========
function isMobileView() {
  return window.innerWidth <= 768;
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const expandBtn = document.getElementById("sidebar-expand");
  const overlay = document.getElementById("sidebar-overlay");

  if (isMobileView()) {
    // 移动端：使用 mobile-open 类 + 遮罩
    const isOpen = sidebar.classList.contains("mobile-open");
    if (isOpen) {
      sidebar.classList.remove("mobile-open");
      expandBtn.classList.add("show");
      expandBtn.classList.remove("activated");
      if (overlay) overlay.classList.remove("show");
    } else {
      sidebar.classList.add("mobile-open");
      expandBtn.classList.remove("show");
      expandBtn.classList.remove("activated");
      if (overlay) overlay.classList.add("show");
    }
  } else {
    // 桌面端：原有折叠逻辑
    if (sidebar.classList.contains("collapsed")) {
      sidebar.classList.remove("collapsed");
      expandBtn.classList.remove("show");
      localStorage.setItem("sidebarCollapsed", "false");
    } else {
      sidebar.classList.add("collapsed");
      expandBtn.classList.add("show");
      localStorage.setItem("sidebarCollapsed", "true");
    }
  }
}

// 移动端侧边栏展开按钮：两步点击（防误触）
// 桌面端：直接打开侧边栏
(function initExpandBtn() {
  const expandBtn = document.getElementById("sidebar-expand");
  if (!expandBtn) return;

  expandBtn.addEventListener("click", function (e) {
    if (isMobileView()) {
      // 移动端：两步点击
      if (!this.classList.contains("activated")) {
        // 第一次点击：激活按钮
        e.preventDefault();
        e.stopPropagation();
        this.classList.add("activated");
        // 3秒后自动回到静默状态
        this._deactivateTimer = setTimeout(() => {
          this.classList.remove("activated");
        }, 3000);
      } else {
        // 第二次点击：打开侧边栏
        clearTimeout(this._deactivateTimer);
        this.classList.remove("activated");
        toggleSidebar();
      }
    } else {
      // 桌面端：直接打开
      toggleSidebar();
    }
  });
})();

// 页面加载时恢复侧边栏状态
(function restoreSidebar() {
  if (isMobileView()) {
    // 移动端默认收起，显示展开按钮
    document.getElementById("sidebar-expand")?.classList.add("show");
  } else {
    if (localStorage.getItem("sidebarCollapsed") === "true") {
      document.getElementById("sidebar")?.classList.add("collapsed");
      document.getElementById("sidebar-expand")?.classList.add("show");
    }
  }
})();

// ========== 新建生词（生词本页面） ==========
async function addNewVocab() {
  const result = await showVocabForm();
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
      source_dictation_id: null,
    }),
  });
  if (res.ok) {
    const data = await res.json();
    if (data.merged) {
      showToast("已合并到已有生词");
    } else {
      showToast("已添加");
    }
    window.location.reload();
  } else {
    showToast("添加失败");
  }
}

// ========== 编辑生词（生词本页面） ==========
async function editVocabFromList(vocabId) {
  const card = document.querySelector(`.vocab-card[data-id="${vocabId}"]`);
  if (!card) return;
  const word = card.querySelector(".vocab-word").textContent.trim();
  const phoneticEl = card.querySelector(".vocab-phonetic");
  const phonetic = phoneticEl
    ? phoneticEl.textContent.replace(/^\//, "").replace(/\/$/, "").trim()
    : "";
  const posEl = card.querySelector(".vocab-pos");
  const pos = posEl ? posEl.textContent.trim() : "";
  const pastTenseEl = card.querySelector(".vocab-past-tense");
  const pastTense = pastTenseEl
    ? pastTenseEl.textContent.replace(/^过去式：/, "").trim()
    : "";
  const pastParticipleEl = card.querySelector(".vocab-past-participle");
  const pastParticiple = pastParticipleEl
    ? pastParticipleEl.textContent.replace(/^过去分词：/, "").trim()
    : "";
  const translationEl = card.querySelector(".vocab-translation");
  const translation = translationEl ? translationEl.textContent.trim() : "";
  const notesEl = card.querySelector(".vocab-notes");
  const notes = notesEl ? notesEl.textContent.trim() : "";

  // 从标签徽章读取当前 labels
  const labels = [];
  card.querySelectorAll(".label-badge").forEach((badge) => {
    if (badge.textContent.includes("读不懂")) labels.push("cannot_read");
    if (badge.textContent.includes("听不懂")) labels.push("cannot_understand");
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
    }),
  });
  if (res.ok) {
    window.location.reload();
  } else {
    showToast("保存失败");
  }
}

// ========== 生词表单（带查询去重） ==========
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

    // 单词失焦时仅搜索去重（不自动调用 DeepSeek）
    wordInput.addEventListener("blur", async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      try {
        const res = await fetch(
          `/api/vocabulary/search?word=${encodeURIComponent(word)}`,
        );
        const data = await res.json();
        if (data.found) {
          phoneticInput.value = data.phonetic;
          posInput.value = data.pos;
          pastTenseInput.value = data.past_tense;
          pastParticipleInput.value = data.past_participle;
          translationInput.value = data.translation;
          if (data.notes) notesInput.value = data.notes;
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
      close({
        word,
        phonetic: phoneticInput.value.trim(),
        pos: posInput.value.trim(),
        past_tense: pastTenseInput.value.trim(),
        past_participle: pastParticipleInput.value.trim(),
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

// 删除生词
async function deleteVocab(id) {
  if (!(await showInlineConfirm("确认删除该生词？"))) return;
  const res = await fetch(`/api/vocabulary/${id}`, { method: "DELETE" });
  if (res.ok) {
    document.querySelector(`[data-id="${id}"]`)?.remove();
  } else {
    showToast("删除失败");
  }
}

// 删除听写
async function deleteDictation(id) {
  if (
    !(await showInlineConfirm("确认删除该听写？所有卡片和关联生词将一并删除。"))
  )
    return;
  const res = await fetch(`/api/dictations/${id}`, { method: "DELETE" });
  if (res.ok) {
    window.location.reload();
  } else {
    showToast("删除失败");
  }
}

// ========== 听写本拖拽排序 ==========
function initDictationDragSort() {
  const container = document.getElementById("dictations-container");
  if (!container) return;
  let draggedItem = null;

  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".list-item");
    if (!item) return;
    draggedItem = item;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  container.addEventListener("dragend", (e) => {
    const item = e.target.closest(".list-item");
    if (item) item.classList.remove("dragging");
    draggedItem = null;
    // 保存新顺序
    const newOrder = Array.from(container.querySelectorAll(".list-item")).map(
      (el) => parseInt(el.dataset.dictationId),
    );
    fetch("/api/dictations/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dictation_ids: newOrder }),
    });
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!draggedItem) return;
    const afterElement = getDragAfterElement(container, draggedItem, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggedItem);
    } else {
      container.insertBefore(draggedItem, afterElement);
    }
  });
}

function getDragAfterElement(container, draggedItem, y) {
  const items = [...container.querySelectorAll(".list-item:not(.dragging)")];
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

document.addEventListener("DOMContentLoaded", initDictationDragSort);

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

// ========== Toast 提示 ==========
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

import { UNCLASSIFIED_ID, RESOURCE_RULES } from "../shared/constants.js";
import { generateTitleFromText } from "../shared/model.js";
import { processImageBlob } from "../shared/image.js";
import {
  clearCandidateDirectoryHandle,
  getDirectoryHandle,
  requestDirectoryPermission,
  saveCandidateDirectoryHandle
} from "../shared/idb-handle.js";
import { buildZipBlob, parseZipFile } from "./zip.js";
import { setButtonIcon, createIcon } from "./icons.js";
import { pickNativeDirectory, datasetFingerprint } from "../shared/native-directory.js";
import { ImageCache } from "./image-cache.js";
import { DEBUG_ENABLED_KEY } from "../shared/debug-log.js";

const $ = (selector) => document.querySelector(selector);

const DICT = {
  zh: {
    all: "全部",
    uncategorized: "未分类",
    trash: "回收站",
    empty: "还没有收藏",
    emptyTrash: "回收站是空的",
    noPrompt: "无提示词",
    imageLoading: "加载图片…",
    imageMissing: "图片缺失",
    imageCorrupt: "图片损坏",
    imagePermission: "目录需授权",
    imageUnavailable: "图片不可访问",
    copy: "复制",
    copied: "已复制",
    edit: "编辑",
    delete: "删除",
    restore: "恢复",
    permanentDelete: "永久删除",
    confirmDelete: "将选中条目移入回收站？",
    confirmPermanent: "永久删除后无法恢复，确定继续？",
    confirmEmptyTrash: "确定永久删除回收站中的全部条目？",
    confirmReplace: "导入并替换会覆盖当前数据。已保存恢复副本，仍要继续？",
    localStorage: "本地存储",
    directoryStorage: "目录存储",
    directoryGranted: "目录可读写",
    directoryPrompt: "目录需要重新授权",
    directoryDenied: "目录授权已失效",
    pending: "待保存内容",
    readOnly: "目录当前不可写，正在显示最近缓存；不会静默切回本地。",
    selected: "已选",
    selectAll: "全选当前结果",
    batchCategory: "修改分类",
    batchDelete: "删除",
    cancel: "取消",
    loadMore: "下一页",
    previousPage: "上一页",
    addTitle: "添加提示词",
    editTitle: "编辑条目",
    categoryPlaceholder: "输入或选择分类（可新建）",
    noImage: "无图片",
    chooseImage: "选择图片",
    save: "保存",
    copyPrompt: "复制提示词",
    search: "搜索标题或提示词",
    latest: "最新收藏",
    earliest: "最早收藏",
    modified: "最近修改",
    titleSort: "标题 A-Z",
    directoryExists: "目录已有数据",
    settings: "设置",
    exportDone: "ZIP 已生成",
    importDone: "ZIP 导入完成",
    added: "新增",
    skipped: "跳过",
    repaired: "恢复图片",
    categoryAdded: "分类已添加",
    categoryRenamed: "分类已重命名",
    categoryDeleted: "分类已删除",
    saved: "已保存",
    movedTrash: "已移入回收站",
    restored: "已恢复",
    deleted: "已永久删除",
    checked: "图片检查完成",
    directoryReady: "目录存储已启用",
    localReady: "已迁移并切回本地存储",
    pendingDone: "待保存内容已重试",
    permissionGranted: "目录已重新授权",
    emptyHelp: "选中文字或图片后右键收藏，或者点击右上角 ＋。",
    titleLabel: "标题",
    categoryLabel: "分类",
    promptLabel: "提示词",
    settingsHeading: "设置",
    storageHeading: "存储",
    chooseFolder: "选择储存文件夹",
    reauthorize: "重新授权",
    directoryPermissionHelp: "已授权目录会直接复用；若浏览器再次询问，可选择“每次访问都允许”。长期授权由浏览器管理。",
    switchLocal: "迁移并切回本地",
    retryPending: "重试待保存内容",
    categoryManagement: "分类管理",
    newCategoryPlaceholder: "新分类名称",
    add: "添加",
    displayHeading: "显示",
    languageLabel: "语言",
    themeLabel: "主题",
    themeLight: "明亮",
    themeDark: "暗黑",
    importExportHeading: "导入导出",
    exportNote: "ZIP 默认包含回收站；缺失图片保留引用但不会伪造文件。",
    exportZip: "导出 ZIP",
    importMerge: "导入并合并",
    importReplace: "导入并替换",
    chooseZip: "选择 ZIP",
    directoryChoiceHelp: "这个文件夹里已经有 PromptSave 数据。请选择如何处理当前收藏。",
    useDataset: "使用该数据集",
    mergeCurrent: "合并当前收藏",
    fullPage: "完整页面",
    githubRepo: "访问 GitHub 仓库",
    openFolder: "打开数据储存文件夹",
    nativeConnect: "连接本地目录（免重复授权）",
    nativeStorage: "本地桥接目录",
    nativeUnavailable: "本地桥接或目录不可用，请检查安装和目录位置",
    nativeHelp: "先双击项目 native/install.bat 注册桥接，再连接数据目录。原有目录请选同一个文件夹。连接后无需浏览器重复授权；工具栏文件夹按钮可打开 Windows 资源管理器。",
    clearLocalTitle: "清除浏览器内部数据",
    clearLocal: "清除本地储存",
    clearLocalHelp: "删除浏览器内部存储中的提示词、图片和待保存内容，无法恢复；不会删除已连接数据文件夹中的文件。",
    clearLocalConfirmLocal: "将清除浏览器内部存储中的全部提示词、图片和待保存内容，且无法恢复。建议先导出 ZIP 备份。确定继续吗？",
    clearLocalConfirmDirectory: "当前使用外部数据文件夹。将只清除浏览器内部的本地数据缓存与待保存内容，不会删除文件夹中的 data.json 和图片。确定继续吗？",
    clearLocalDone: "本地储存已清除",
    viewTitle: "查看条目",
    viewImage: "图片",
    viewText: "完整提示词",
    closeView: "关闭",
    editView: "编辑",
    copyView: "复制提示词",
    debugPage: "打开调试页",
    checkImages: "检查图片",
    bulkManagement: "批量管理",
    gridList: "网格/列表",
    addPrompt: "添加提示词",
    sortLabel: "排序",
    close: "关闭",
    operationFailed: "操作失败",
    listenClipboard: "监听剪贴板：开启后右键“复制图片”将自动收藏",
    listenStarted: "剪贴板监听已开启，右键“复制图片”后将自动收藏",
    listenStopped: "已停止监听剪贴板",
    colTitle: "标题",
    colPreview: "内容预览",
    colCategory: "分类",
    colActions: "操作"
  },
  en: {
    all: "All",
    uncategorized: "Uncategorized",
    trash: "Trash",
    empty: "No saved items yet",
    emptyTrash: "Trash is empty",
    noPrompt: "No prompt",
    imageLoading: "Loading image…",
    imageMissing: "Image missing",
    imageCorrupt: "Image damaged",
    imagePermission: "Folder permission required",
    imageUnavailable: "Image unavailable",
    copy: "Copy",
    copied: "Copied",
    edit: "Edit",
    delete: "Delete",
    restore: "Restore",
    permanentDelete: "Delete forever",
    confirmDelete: "Move selected items to Trash?",
    confirmPermanent: "This cannot be undone. Delete permanently?",
    confirmEmptyTrash: "Permanently delete everything in Trash?",
    confirmReplace: "Replace import will overwrite current data. A recovery snapshot is kept. Continue?",
    localStorage: "Local storage",
    directoryStorage: "Folder storage",
    directoryGranted: "Folder is writable",
    directoryPrompt: "Folder needs authorization",
    directoryDenied: "Folder authorization expired",
    pending: "Pending saves",
    readOnly: "Folder is not writable. Showing the latest cache; storage will not silently fall back to local.",
    selected: "Selected",
    selectAll: "Select all filtered",
    batchCategory: "Change category",
    batchDelete: "Delete",
    cancel: "Cancel",
    loadMore: "Next page",
    previousPage: "Previous page",
    addTitle: "Add prompt",
    editTitle: "Edit item",
    categoryPlaceholder: "Type or choose a category",
    noImage: "No image",
    chooseImage: "Choose image",
    save: "Save",
    copyPrompt: "Copy prompt",
    search: "Search title or prompt",
    latest: "Newest",
    earliest: "Oldest",
    modified: "Recently edited",
    titleSort: "Title A-Z",
    directoryExists: "Folder already contains data",
    settings: "Settings",
    exportDone: "ZIP created",
    importDone: "ZIP imported",
    added: "added",
    skipped: "skipped",
    repaired: "images restored",
    categoryAdded: "Category added",
    categoryRenamed: "Category renamed",
    categoryDeleted: "Category deleted",
    saved: "Saved",
    movedTrash: "Moved to Trash",
    restored: "Restored",
    deleted: "Deleted permanently",
    checked: "Image check finished",
    directoryReady: "Folder storage enabled",
    localReady: "Migrated back to local storage",
    pendingDone: "Pending saves retried",
    permissionGranted: "Folder reauthorized",
    emptyHelp: "Right-click selected text or an image to save it, or use ＋.",
    titleLabel: "Title",
    categoryLabel: "Category",
    promptLabel: "Prompt",
    settingsHeading: "Settings",
    storageHeading: "Storage",
    chooseFolder: "Choose storage folder",
    reauthorize: "Reauthorize",
    directoryPermissionHelp: "Granted folder access is reused. If offered, choose Allow on every visit. Persistent access is managed by the browser.",
    switchLocal: "Migrate back to local",
    retryPending: "Retry pending saves",
    categoryManagement: "Category management",
    newCategoryPlaceholder: "New category name",
    add: "Add",
    displayHeading: "Display",
    languageLabel: "Language",
    themeLabel: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    importExportHeading: "Import / Export",
    exportNote: "ZIP exports include Trash by default. Missing image references are preserved without fabricating files.",
    exportZip: "Export ZIP",
    importMerge: "Import and merge",
    importReplace: "Import and replace",
    chooseZip: "Choose ZIP",
    directoryChoiceHelp: "This folder already contains PromptSave data. Choose how to handle the current collection.",
    useDataset: "Use this dataset",
    mergeCurrent: "Merge current collection",
    fullPage: "Full page",
    githubRepo: "Open GitHub repository",
    openFolder: "Open storage folder in Explorer",
    nativeConnect: "Connect local folder (persistent access)",
    nativeStorage: "Native folder storage",
    nativeUnavailable: "Native bridge or folder unavailable; check installation and folder location",
    nativeHelp: "Double-click native/install.bat first, then connect the data folder. Select the same folder for existing data. Native access survives browser restarts; the toolbar folder button opens Windows Explorer.",
    clearLocalTitle: "Clear browser-internal data",
    clearLocal: "Clear local storage",
    clearLocalHelp: "Deletes prompts, images and pending saves kept inside the browser; this cannot be undone. Files in a connected storage folder are never deleted.",
    clearLocalConfirmLocal: "This permanently deletes every prompt, image and pending save in the browser's internal storage. Consider exporting a ZIP first. Continue?",
    clearLocalConfirmDirectory: "You are using an external storage folder. Only the browser's internal cache and pending saves will be cleared; data.json and images in the folder are kept. Continue?",
    clearLocalDone: "Local storage cleared",
    viewTitle: "View item",
    viewImage: "Image",
    viewText: "Full prompt",
    closeView: "Close",
    editView: "Edit",
    copyView: "Copy prompt",
    debugPage: "Open debug page",
    checkImages: "Check images",
    bulkManagement: "Bulk manage",
    gridList: "Grid / list",
    addPrompt: "Add prompt",
    sortLabel: "Sort",
    close: "Close",
    operationFailed: "Operation failed",
    listenClipboard: "Monitor clipboard: when on, right-click Copy image saves automatically",
    listenStarted: "Clipboard monitoring is on. Right-click an image and choose Copy image.",
    listenStopped: "Clipboard monitoring stopped.",
    colTitle: "Title",
    colPreview: "Preview",
    colCategory: "Category",
    colActions: "Actions"
  }
};

let state = null;
let savedDirectoryHandle = null;
let directoryConnecting = false;
let reloadToken = 0;
let reloadPromise = null;
let reloadForcePending = false;
let reloadAgain = false;
let visibleOffset = 0;
const imageCache = new ImageCache();
const DIRECTORY_ACTIONS = new Set([
  "item:add", "item:update", "items:softDelete", "item:restore", "item:deletePermanent",
  "trash:empty", "items:bulkCategory", "category:add", "category:rename", "category:delete",
  "import:apply", "storage:toLocal", "pending:retry", "export:get"
]);
let batchMode = false;
let selectedIds = new Set();
let visibleLimit = RESOURCE_RULES.pageItems;
let editingId = null;
let pendingImage = null;
let currentObjectUrls = new Map();
const displayedPixels = new Map();
let imageStatuses = new Map();
let renderedImageIds = new Set();
let imageObserver = null;
let noticeTimer = null;
let directoryChoiceResolver = null;
let noticeState = null;
let noticeDialog = null;
let noticeReturnStack = [];
let lastCaptureFeedbackId = null;
let lastCaptureFeedbackTime = 0;
let itemDialogToken = 0;
let itemDialogSaving = false;
let dialogImageProcessing = false;
let dialogImageRequestToken = 0;
let itemDialogClosingToken = null;
let viewDialogToken = 0;
let viewItemId = null;
let viewPromptText = "";
let viewDialogClosingToken = null;
let imageRenderToken = 0;
let archiveBusy = false;
let imageDebugEnabled = false;
chrome.storage.local.get(DEBUG_ENABLED_KEY).then((stored) => { imageDebugEnabled = !!stored[DEBUG_ENABLED_KEY]; }).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[DEBUG_ENABLED_KEY]) imageDebugEnabled = !!changes[DEBUG_ENABLED_KEY].newValue;
});

function t(key) {
  const lang = state && state.settings && state.settings.language === "en" ? "en" : "zh";
  return DICT[lang][key] || DICT.zh[key] || key;
}

function pageSize() { return Math.min(RESOURCE_RULES.pageItems, Math.max(1, Number(state?.settings.pageSize) || 8)); }

async function cachedImage(item, valid, priority = false) {
  const image = item.image;
  const scope = [state.settings.storageMode, savedDirectoryHandle?.rootId || state.settings.directoryName || "", state.data.datasetId];
  const key = [...scope, image.id, image.bytes, image.width, image.height].join(":");
  const started = performance.now();
  const result = await imageCache.get(key, () => send("image:get", { id: item.id }), valid, priority);
  if (imageDebugEnabled) chrome.runtime.sendMessage({ action: "debug:image", cacheHit: !!result.cacheHit, durationMs: Math.round(performance.now() - started) }).catch(() => {});
  return result;
}

async function send(action, payload = {}) {
  await authorizeDirectoryForAction(action);
  let response;
  try {
    response = await chrome.runtime.sendMessage({ action, ...payload });
  } catch (error) {
    throw new Error(error && error.message ? error.message : "扩展后台不可用");
  }
  if (!response || !response.ok) {
    const error = new Error(response && response.error && response.error.message ? response.error.message : t("operationFailed"));
    error.code = response && response.error ? response.error.code : "UNKNOWN_ERROR";
    error.details = response && response.error ? response.error.details : null;
    throw error;
  }
  return response.data;
}

async function authorizeDirectoryForAction(action) {
  if (!DIRECTORY_ACTIONS.has(action) || state?.settings.storageMode !== "directory" ||
      !savedDirectoryHandle || !navigator.userActivation?.isActive) return;
  // The live handle is loaded before the click. Request immediately while its gesture is active.
  const permission = await requestDirectoryPermission(savedDirectoryHandle, "readwrite");
  if (!["granted", "unknown"].includes(permission)) {
    state.directory.permission = permission;
    const error = new Error(t("directoryDenied"));
    error.code = "DIRECTORY_PERMISSION_REQUIRED";
    throw error;
  }
  state.directory.permission = permission;
  state.readOnly = false;
  clearReadOnlyNotice();
}

function showNotice(message, kind = "info", timeout = 3200, priority = 30) {
  const notice = $("#notice");
  if (!notice) return false;
  if (noticeState && noticeState.priority > priority) return false;
  if (noticeTimer) clearTimeout(noticeTimer);
  const token = {};
  noticeState = { token, priority };
  notice.textContent = String(message || "");
  notice.className = "notice " + kind;
  if (timeout > 0) {
    noticeTimer = setTimeout(() => {
      if (!noticeState || noticeState.token !== token) return;
      notice.className = "notice hidden";
      noticeState = null;
      noticeTimer = null;
    }, timeout);
  } else {
    noticeTimer = null;
  }
  return true;
}

function moveNoticeIntoDialog(dialog) {
  const notice = $("#notice");
  if (!notice || !dialog) return;
  if (noticeDialog === dialog) return;
  noticeReturnStack.push({
    dialog,
    parent: notice.parentNode,
    nextSibling: notice.nextSibling,
    previousDialog: noticeDialog
  });
  noticeDialog = dialog;
  const head = dialog.querySelector(".modal-head");
  const parent = head ? head.parentElement : dialog;
  if (head && head.nextSibling) parent.insertBefore(notice, head.nextSibling);
  else parent.appendChild(notice);
}

function restoreNoticeToApp(dialog = null) {
  if (!noticeDialog || (dialog && noticeDialog !== dialog)) return;
  const notice = $("#notice");
  if (!notice) return;
  const frame = noticeReturnStack.pop();
  if (frame && frame.parent) {
    const next = frame.nextSibling && frame.nextSibling.parentNode === frame.parent
      ? frame.nextSibling
      : null;
    frame.parent.insertBefore(notice, next);
    noticeDialog = frame.previousDialog;
  } else {
    noticeDialog = null;
  }
}

function showModal(dialog) {
  if (!dialog) return;
  moveNoticeIntoDialog(dialog);
  dialog.showModal();
}

function revokeObjectUrl(key) {
  const url = currentObjectUrls.get(key);
  if (!url) return;
  URL.revokeObjectURL(url);
  currentObjectUrls.delete(key);
  displayedPixels.delete(key);
}

function revokeObjectUrls(predicate = () => true) {
  for (const [key, url] of currentObjectUrls.entries()) {
    if (!predicate(key)) continue;
    URL.revokeObjectURL(url);
    currentObjectUrls.delete(key);
    displayedPixels.delete(key);
  }
}

function clearDialogObjectUrls() {
  revokeObjectUrls((key) => String(key).startsWith("dialog-"));
}

function clearViewObjectUrls() {
  revokeObjectUrls((key) => String(key).startsWith("view-"));
}

function clearReadOnlyNotice() {
  if (!noticeState || noticeState.priority !== 10) return;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  noticeState = null;
  const notice = $("#notice");
  if (notice) notice.className = "notice hidden";
}

function base64ToBlob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

function allocateImageUrl(key, blob, width, height) {
  revokeObjectUrl(key);
  const pixels = Math.max(1, Number(width) * Number(height) || 1);
  let total = [...displayedPixels.values()].reduce((sum, value) => sum + value, 0);
  for (const oldKey of [...currentObjectUrls.keys()]) {
    if (total + pixels <= RESOURCE_RULES.uiDecodedPixels) break;
    if (!oldKey.startsWith("card-")) continue;
    total -= displayedPixels.get(oldKey) || 0;
    revokeObjectUrl(oldKey);
    const container = [...document.querySelectorAll(".card-image")].find((node) => node.dataset.imageItemId === oldKey.slice(5));
    if (container) container.textContent = state.settings.language === "en" ? "Click to view image" : "点击查看图片";
  }
  if (total + pixels > RESOURCE_RULES.uiDecodedPixels) throw new Error("图片展示已达内存预算，请关闭其他图片窗口后重试");
  const url = URL.createObjectURL(blob);
  currentObjectUrls.set(key, url);
  displayedPixels.set(key, pixels);
  return url;
}

function applyTheme() {
  const theme = state && state.settings ? state.settings.theme : "light";
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

function applyLanguage() {
  const lang = state && state.settings && state.settings.language === "en" ? "en" : "zh";
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  $("#searchInput").placeholder = t("search");
  $("#loadMoreBtn").textContent = t("loadMore");
  $("#previousPageBtn").textContent = t("previousPage");
  $("#selectAllText").textContent = t("selectAll");
  $("#batchMoveBtn").textContent = t("batchCategory");
  $("#batchDeleteBtn").textContent = t("batchDelete");
  $("#batchCancelBtn").textContent = t("cancel");
  $("#sortSelect").options[0].textContent = t("latest");
  $("#sortSelect").options[1].textContent = t("earliest");
  $("#sortSelect").options[2].textContent = t("modified");
  $("#sortSelect").options[3].textContent = t("titleSort");
  if (!$("#itemDialog").open) {
    $("#itemDialogTitle").textContent = editingId ? t("editTitle") : t("addTitle");
  }
  $("#itemCategoryInput").placeholder = t("categoryPlaceholder");
  $("#copyFromDialogBtn").textContent = t("copyPrompt");
  $("#cancelItemBtn").textContent = t("cancel");
  const saveButton = $("#itemForm button[type=submit]");
  if (saveButton) saveButton.textContent = t("save");
  if (!$("#viewDialog").open) $("#viewDialogTitle").textContent = t("viewTitle");
  $("#viewImageHeading").textContent = t("viewImage");
  $("#viewPromptHeading").textContent = t("viewText");
  $("#editViewBtn").textContent = t("editView");
  $("#copyViewBtn").textContent = t("copyView");
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const key = node.dataset.i18n;
    if (DICT[lang][key]) node.textContent = DICT[lang][key];
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    const key = node.dataset.i18nTitle;
    if (DICT[lang][key]) node.title = DICT[lang][key];
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = node.dataset.i18nPlaceholder;
    if (DICT[lang][key]) node.placeholder = DICT[lang][key];
  }
  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
    const key = node.dataset.i18nAriaLabel;
    if (DICT[lang][key]) node.setAttribute("aria-label", DICT[lang][key]);
  }
  $("#emptyText").textContent = t("emptyHelp");
  for (const [id, icon, label] of [
    ["listenBtn", "listen", "listenClipboard"],
    ["openDirectoryBtn", "folder", "openFolder"], ["openFullBtn", "fullscreen", "fullPage"],
    ["refreshBtn", "refresh", "checkImages"], ["batchBtn", "manage", "bulkManagement"],
    ["viewBtn", "grid", "gridList"], ["settingsBtn", "settings", "settings"],
    ["addBtn", "add", "addPrompt"], ["closeItemBtn", "close", "close"],
    ["closeViewBtn", "close", "close"], ["closeSettingsBtn", "close", "close"]
  ]) setButtonIcon($("#" + id), icon, { label: t(label) });
  $("#editViewBtn").prepend(createIcon("edit", 18));
}

function showCaptureFeedback(feedback) {
  if (!feedback || !feedback.id) return;
  const feedbackId = String(feedback.id);
  const feedbackTime = Number(feedback.time || 0);
  if (feedbackId === lastCaptureFeedbackId || feedbackTime < lastCaptureFeedbackTime) return;
  lastCaptureFeedbackId = feedbackId;
  lastCaptureFeedbackTime = Math.max(lastCaptureFeedbackTime, feedbackTime);
  const kind = ["error", "warning", "success"].includes(feedback.kind) ? feedback.kind : "info";
  const timeout = kind === "success" ? 3000 : 0;
  showNotice(feedback.message || t("operationFailed"), kind, timeout, 30);
}

function reloadState(force = false) {
  if (force) reloadForcePending = true;
  if (reloadPromise) return reloadPromise;
  reloadPromise = (async () => {
    do {
      reloadAgain = false;
      const refreshing = reloadForcePending;
      reloadForcePending = false;
      if (refreshing) imageCache.clear();
      await performReloadState(refreshing);
    } while (reloadForcePending || reloadAgain);
  })().finally(() => { reloadPromise = null; });
  return reloadPromise;
}

async function performReloadState(force) {
  const token = ++reloadToken;
  const next = await send("state:get", { force });
  const handle = await getDirectoryHandle();
  if (token !== reloadToken) return;
  savedDirectoryHandle = handle || null;
  state = next;
  visibleLimit = pageSize();
  $("#sortSelect").value = state.settings.sort || "created-desc";
  $("#languageSelect").value = state.settings.language || "zh";
  $("#themeSelect").value = state.settings.theme || "light";
  applyTheme();
  applyLanguage();
  renderStorageStatus();
  renderListenButton();
  renderCategories();
  renderBatchBar();
  renderItems();
  renderCategoryManager();
  showCaptureFeedback(next.captureFeedback);
}

function activeCategory() {
  return state && state.settings ? state.settings.activeCategory || "all" : "all";
}

function filteredItems() {
  if (!state) return [];
  const category = activeCategory();
  const query = $("#searchInput").value.trim().toLocaleLowerCase();
  let items = state.data.items.filter((item) => {
    if (category === "trash") return !!item.deletedAt;
    if (item.deletedAt) return false;
    if (category !== "all" && item.categoryId !== category) return false;
    return true;
  });

  if (query) {
    items = items.filter((item) =>
      item.title.toLocaleLowerCase().includes(query) ||
      item.prompt.toLocaleLowerCase().includes(query)
    );
  }

  const sort = state.settings.sort || "created-desc";
  items.sort((a, b) => {
    if (sort === "created-asc") return a.createdAt.localeCompare(b.createdAt);
    if (sort === "modified-desc") return b.updatedAt.localeCompare(a.updatedAt);
    if (sort === "title-asc") return a.title.localeCompare(b.title, state.settings.language === "en" ? "en" : "zh-CN");
    return b.createdAt.localeCompare(a.createdAt);
  });
  return items;
}

function clearSelection() {
  selectedIds.clear();
  $("#selectAllCheckbox").checked = false;
}

async function setActiveCategory(categoryId) {
  visibleOffset = 0;
  clearSelection();
  visibleLimit = pageSize();
  state.settings.activeCategory = categoryId;
  await send("settings:update", { patch: { activeCategory: categoryId } });
  renderCategories();
  renderBatchBar();
  renderItems();
}

function makeCategoryButton(id, label, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-chip" + (activeCategory() === id ? " active" : "");
  button.textContent = label + (typeof count === "number" ? " " + count : "");
  button.addEventListener("click", () => setActiveCategory(id).catch(handleError));
  return button;
}

function renderCategories() {
  if (!state) return;
  const bar = $("#categoryBar");
  bar.replaceChildren();
  const activeItems = state.data.items.filter((item) => !item.deletedAt);
  const trashCount = state.data.items.length - activeItems.length;
  bar.appendChild(makeCategoryButton("all", t("all"), activeItems.length));
  bar.appendChild(makeCategoryButton(
    UNCLASSIFIED_ID,
    t("uncategorized"),
    activeItems.filter((item) => item.categoryId === UNCLASSIFIED_ID).length
  ));
  for (const category of state.data.categories) {
    const count = activeItems.filter((item) => item.categoryId === category.id).length;
    bar.appendChild(makeCategoryButton(category.id, category.name, count));
  }
  const addCategory = document.createElement("button");
  addCategory.type = "button";
  addCategory.className = "category-chip";
  setButtonIcon(addCategory, "add", {
    label: state.settings.language === "en" ? "Add category" : "添加分类", size: 16
  });
  addCategory.addEventListener("click", () => {
    renderSettingsDialog();
    showModal($("#settingsDialog"));
    setTimeout(() => $("#newCategoryInput").focus(), 0);
  });
  bar.appendChild(addCategory);
  bar.appendChild(makeCategoryButton("trash", t("trash"), trashCount));
}

function renderBatchBar() {
  const bar = $("#batchBar");
  bar.classList.toggle("hidden", !batchMode);
  $("#batchBtn").classList.toggle("active", batchMode);
  $("#selectedCount").textContent = t("selected") + " " + selectedIds.size;
  const select = $("#batchCategorySelect");
  select.replaceChildren();
  const unclassified = document.createElement("option");
  unclassified.value = UNCLASSIFIED_ID;
  unclassified.textContent = t("uncategorized");
  select.appendChild(unclassified);
  for (const category of state ? state.data.categories : []) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  }
  const inTrash = activeCategory() === "trash";
  select.disabled = inTrash;
  $("#batchMoveBtn").disabled = inTrash;
  $("#selectAllCheckbox").checked = filteredItems().length > 0 &&
    filteredItems().every((item) => selectedIds.has(item.id));
}

function createButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (label === t("edit")) setButtonIcon(button, "edit", { label: t("edit"), size: 16 });
  if (label === t("copy")) button.prepend(createIcon("copy", 13));
  if (label === "×") setButtonIcon(button, "trash", {
    label: activeCategory() === "trash" ? t("permanentDelete") : t("delete"), size: 16
  });
  if (className) button.className = className;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    Promise.resolve(handler()).catch(handleError);
  });
  return button;
}

function statusLabel(status) {
  if (status === "missing") return t("imageMissing");
  if (status === "corrupt") return t("imageCorrupt");
  if (status === "permission") return t("imagePermission");
  if (status === "unavailable") return t("imageUnavailable");
  return "";
}

function isCurrentCardImage(container, token) {
  return container.isConnected && container.dataset.imageRenderToken === String(token);
}

async function loadCardImage(item, container, token) {
  if (!item.image || document.visibilityState !== "visible" || !isCurrentCardImage(container, token)) return;
  container.textContent = t("imageLoading");
  const result = await cachedImage(item, () => isCurrentCardImage(container, token) && container.dataset.visible === "true");
  if (!isCurrentCardImage(container, token) || container.dataset.visible !== "true") return;
  imageStatuses.set(item.id, result.status);
  if (result.status !== "ok" || !result.blob) {
    container.textContent = statusLabel(result.status);
    container.classList.add("image-problem");
    return;
  }
  const key = "card-" + item.id;
  revokeObjectUrl(key);
  const url = allocateImageUrl(key, result.blob, result.width, result.height);
  if (!isCurrentCardImage(container, token)) {
    revokeObjectUrl(key);
    return;
  }
  container.replaceChildren();
  container.classList.remove("image-problem");
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = item.title;
  img.src = url;
  img.addEventListener("error", () => {
    if (!isCurrentCardImage(container, token)) return;
    imageStatuses.set(item.id, "corrupt");
    revokeObjectUrl(key);
    container.replaceChildren();
    container.textContent = t("imageCorrupt");
    container.classList.add("image-problem");
  }, { once: true });
  container.appendChild(img);
}

function createCard(item, observer, renderToken) {
  const card = document.createElement("article");
  card.className = "prompt-card" + (selectedIds.has(item.id) ? " selected" : "") +
    (activeCategory() === "trash" ? " trash-item" : "");
  card.dataset.id = item.id;
  card.dataset.viewable = batchMode ? "false" : "true";
  if (!batchMode) {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", item.title);
    const openView = () => openViewDialog(item.id).catch(handleError);
    card.addEventListener("click", (event) => {
      if (event.target.closest("button,input,select,textarea,a,label")) return;
      openView();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target !== card) return;
      event.preventDefault();
      openView();
    });
  }

  if (batchMode) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "card-checkbox";
    checkbox.checked = selectedIds.has(item.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedIds.add(item.id);
      else selectedIds.delete(item.id);
      renderBatchBar();
      card.classList.toggle("selected", checkbox.checked);
    });
    card.appendChild(checkbox);
  }

  const head = document.createElement("div");
  head.className = "card-head";
  const title = document.createElement("strong");
  title.textContent = item.title;
  title.title = item.title;
  head.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (activeCategory() === "trash") {
    actions.appendChild(createButton(t("restore"), "", async () => {
      await send("item:restore", { id: item.id });
      showNotice(t("restored"), "success");
      await reloadState();
    }));
    actions.appendChild(createButton("×", "danger-ghost", async () => {
      if (!confirm(t("confirmPermanent"))) return;
      await send("item:deletePermanent", { id: item.id });
      showNotice(t("deleted"), "success");
      await reloadState();
    }));
  } else {
    actions.appendChild(createButton(t("edit"), "", () => openEditDialog(item.id)));
    actions.appendChild(createButton("×", "danger-ghost", async () => {
      await send("items:softDelete", { ids: [item.id] });
      showNotice(t("movedTrash"), "success");
      await reloadState();
    }));
  }
  head.appendChild(actions);
  card.appendChild(head);

  if (state.settings.view !== "list" && item.image) {
    const image = document.createElement("div");
    image.className = "card-image";
    image.dataset.imageItemId = item.id;
    image.dataset.imageRenderToken = String(renderToken);
    image.textContent = statusLabel(imageStatuses.get(item.id)) || t("imageLoading");
    card.appendChild(image);
    renderedImageIds.add(item.id);
    observer.observe(image);
  }

  const prompt = document.createElement("div");
  prompt.className = "card-prompt";
  prompt.textContent = item.prompt || t("noPrompt");
  if (!item.prompt) prompt.classList.add("muted");
  card.appendChild(prompt);

  const footer = document.createElement("div");
  footer.className = "card-footer";
  const category = document.createElement("span");
  category.textContent = item.categoryId === UNCLASSIFIED_ID
    ? t("uncategorized")
    : (state.data.categories.find((entry) => entry.id === item.categoryId)?.name || t("uncategorized"));
  footer.appendChild(category);
  footer.appendChild(createButton(t("copy"), "copy-btn", async () => {
    await navigator.clipboard.writeText(item.prompt || "");
    showNotice(t("copied"), "success", 1500);
  }));
  card.appendChild(footer);

  return card;
}

function categoryDisplayName(item) {
  if (item.categoryId === UNCLASSIFIED_ID) return t("uncategorized");
  return state.data.categories.find((entry) => entry.id === item.categoryId)?.name || t("uncategorized");
}

function createRowIconButton(iconName, label, handler, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  setButtonIcon(button, iconName, { label, size: 16 });
  if (extraClass) button.className = extraClass;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    Promise.resolve(handler()).catch(handleError);
  });
  return button;
}

function wireRowOpen(row, item) {
  if (batchMode) {
    row.dataset.viewable = "false";
    return;
  }
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", item.title);
  const openView = () => openViewDialog(item.id).catch(handleError);
  row.addEventListener("click", (event) => {
    if (event.target.closest("button,input,select,textarea,a,label")) return;
    openView();
  });
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target !== row) return;
    event.preventDefault();
    openView();
  });
}

function createListRow(item) {
  const row = document.createElement("article");
  row.className = "list-row" + (activeCategory() === "trash" ? " trash-item" : "");
  row.dataset.id = item.id;
  row.dataset.viewable = batchMode ? "false" : "true";
  wireRowOpen(row, item);

  const columns = document.createElement("div");
  columns.className = "list-columns";

  if (batchMode) {
    const checkboxCell = document.createElement("div");
    checkboxCell.className = "row-checkbox-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(item.id);
    checkbox.setAttribute("aria-label", item.title);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedIds.add(item.id);
      else selectedIds.delete(item.id);
      renderBatchBar();
      row.classList.toggle("selected", checkbox.checked);
    });
    checkboxCell.appendChild(checkbox);
    columns.appendChild(checkboxCell);
  }

  const titleCell = document.createElement("div");
  titleCell.className = "cell-title";
  const titleStrong = document.createElement("strong");
  titleStrong.textContent = item.title;
  titleStrong.title = item.title;
  titleCell.appendChild(titleStrong);
  columns.appendChild(titleCell);

  const previewCell = document.createElement("div");
  previewCell.className = "cell-preview";
  previewCell.textContent = item.prompt || t("noPrompt");
  previewCell.title = item.prompt || "";
  columns.appendChild(previewCell);

  const categoryCell = document.createElement("div");
  categoryCell.className = "cell-category";
  const pill = document.createElement("span");
  pill.className = "category-pill" + (item.categoryId === UNCLASSIFIED_ID ? " is-muted" : "");
  pill.textContent = categoryDisplayName(item);
  categoryCell.appendChild(pill);
  columns.appendChild(categoryCell);

  const actionsCell = document.createElement("div");
  actionsCell.className = "cell-actions row-actions";
  if (activeCategory() === "trash") {
    actionsCell.appendChild(createButton(t("restore"), "restore-btn", async () => {
      await send("item:restore", { id: item.id });
      showNotice(t("restored"), "success");
      await reloadState();
    }));
    actionsCell.appendChild(createRowIconButton("trash", t("permanentDelete"), async () => {
      if (!confirm(t("confirmPermanent"))) return;
      await send("item:deletePermanent", { id: item.id });
      showNotice(t("deleted"), "success");
      await reloadState();
    }, "danger-ghost"));
  } else {
    actionsCell.appendChild(createRowIconButton("copy", t("copy"), async () => {
      await navigator.clipboard.writeText(item.prompt || "");
      showNotice(t("copied"), "success", 1500);
    }));
    actionsCell.appendChild(createRowIconButton("edit", t("edit"), () => openEditDialog(item.id)));
    actionsCell.appendChild(createRowIconButton("trash", t("delete"), async () => {
      await send("items:softDelete", { ids: [item.id] });
      showNotice(t("movedTrash"), "success");
      await reloadState();
    }, "danger-ghost"));
  }
  columns.appendChild(actionsCell);

  row.appendChild(columns);
  return row;
}

function renderListHead() {
  const head = document.createElement("div");
  head.className = "list-columns list-head";
  if (batchMode) {
    const checkboxHead = document.createElement("span");
    checkboxHead.className = "row-checkbox-cell";
    head.appendChild(checkboxHead);
  }
  const cells = [
    ["cell-title", "colTitle"],
    ["cell-preview", "colPreview"],
    ["cell-category", "colCategory"],
    ["cell-actions", "colActions"]
  ];
  for (const [className, labelKey] of cells) {
    const cell = document.createElement("span");
    cell.className = className;
    cell.textContent = t(labelKey);
    head.appendChild(cell);
  }
  return head;
}

function renderItems() {
  if (!state) return;
  const renderToken = ++imageRenderToken;
  revokeObjectUrls((key) => String(key).startsWith("card-"));
  renderedImageIds = new Set();
  const cards = $("#cards");
  cards.replaceChildren();
  const isList = state.settings.view === "list";
  cards.className = "cards " + (isList ? "list" : "grid");
  cards.classList.toggle("batch", batchMode);

  const all = filteredItems();
  if (visibleOffset >= all.length) visibleOffset = 0;
  const page = all.slice(visibleOffset, visibleOffset + visibleLimit);
  if (imageObserver) imageObserver.disconnect();
  imageObserver = new IntersectionObserver((entries, currentObserver) => {
    for (const entry of entries) {
      entry.target.dataset.visible = String(entry.isIntersecting);
      const id = entry.target.dataset.imageItemId;
      if (!entry.isIntersecting) {
        revokeObjectUrl("card-" + id);
        entry.target.textContent = t("imageLoading");
        renderedImageIds.delete(id);
        continue;
      }
      const item = state.data.items.find((candidate) => candidate.id === id);
      if (item) loadCardImage(item, entry.target, renderToken).catch(handleError);
    }
  }, { rootMargin: "0px" });

  if (isList) cards.appendChild(renderListHead());
  for (const item of page) {
    cards.appendChild(isList
      ? createListRow(item)
      : createCard(item, imageObserver, renderToken));
  }

  const empty = $("#emptyState");
  empty.classList.toggle("hidden", all.length !== 0);
  $("#emptyTitle").textContent = activeCategory() === "trash" ? t("emptyTrash") : t("empty");
  $("#loadMoreBtn").classList.toggle("hidden", visibleOffset + page.length >= all.length);
  $("#previousPageBtn").classList.toggle("hidden", visibleOffset === 0);

  let trashButton = $("#emptyTrashBtn");
  if (activeCategory() === "trash" && all.length) {
    if (!trashButton) {
      trashButton = document.createElement("button");
      trashButton.id = "emptyTrashBtn";
      trashButton.className = "trash-empty-button";
      trashButton.textContent = state.settings.language === "en" ? "Empty Trash" : "清空回收站";
      trashButton.addEventListener("click", async () => {
        if (!confirm(t("confirmEmptyTrash"))) return;
        const result = await send("trash:empty");
        if (result.failed && result.failed.length) {
          showNotice((state.settings.language === "en" ? "Some deletions failed: " : "部分删除失败：") + result.failed.length, "error", 6000);
        } else {
          showNotice(t("deleted"), "success");
        }
        await reloadState();
      });
      $("#emptyState").parentElement.insertBefore(trashButton, cards);
    }
  } else if (trashButton) {
    trashButton.remove();
  }

  renderBatchBar();
}

function categoryNameForId(categoryId) {
  if (!categoryId || categoryId === UNCLASSIFIED_ID) return "";
  return state.data.categories.find((category) => category.id === categoryId)?.name || "";
}

function renderCategoryInput(selectedId) {
  const input = $("#itemCategoryInput");
  const options = $("#itemCategoryOptions");
  options.replaceChildren();
  if (!state.data.categories.some((category) => category.name === t("uncategorized"))) {
    const unclassified = document.createElement("option");
    unclassified.value = t("uncategorized");
    options.appendChild(unclassified);
  }
  for (const category of state.data.categories) {
    const option = document.createElement("option");
    option.value = category.name;
    options.appendChild(option);
  }
  input.value = categoryNameForId(selectedId);
  input.placeholder = t("categoryPlaceholder");
}

function isCurrentItemDialog(token, id = editingId) {
  return itemDialogToken === token && $("#itemDialog").open && editingId === id;
}

function setItemDialogBusy(busy) {
  itemDialogSaving = busy;
  const form = $("#itemForm");
  form.dataset.busy = busy ? "true" : "false";
  for (const control of form.querySelectorAll("button,input,select,textarea")) control.disabled = busy;
  const saveButton = form.querySelector("button[type=submit]");
  if (saveButton) saveButton.disabled = busy || dialogImageProcessing;
}

function updateItemDialogSaveState() {
  const saveButton = $("#itemForm button[type=submit]");
  if (saveButton) saveButton.disabled = itemDialogSaving || dialogImageProcessing;
}

function closeItemDialog() {
  if (itemDialogSaving) return;
  const dialog = $("#itemDialog");
  if (dialog.open) {
    itemDialogClosingToken = itemDialogToken;
    dialog.close();
    restoreNoticeToApp(dialog);
  }
}

async function openAddDialog() {
  if (itemDialogSaving) return;
  if ($("#itemDialog").open) closeItemDialog();
  itemDialogToken += 1;
  dialogImageRequestToken += 1;
  clearDialogObjectUrls();
  dialogImageProcessing = false;
  updateItemDialogSaveState();
  editingId = null;
  pendingImage = null;
  $("#itemDialogTitle").textContent = t("addTitle");
  $("#itemTitleInput").value = "";
  $("#itemPromptInput").value = "";
  renderCategoryInput(["all", "trash"].includes(activeCategory()) ? UNCLASSIFIED_ID : activeCategory());
  resetDialogImage();
  showModal($("#itemDialog"));
}

async function openEditDialog(id) {
  const item = state.data.items.find((entry) => entry.id === id);
  if (!item) return;
  if (itemDialogSaving) return;
  if ($("#itemDialog").open) closeItemDialog();
  itemDialogToken += 1;
  const token = itemDialogToken;
  const imageRequestToken = ++dialogImageRequestToken;
  clearDialogObjectUrls();
  dialogImageProcessing = false;
  updateItemDialogSaveState();
  editingId = id;
  pendingImage = null;
  $("#itemDialogTitle").textContent = t("editTitle");
  $("#itemTitleInput").value = item.title;
  $("#itemPromptInput").value = item.prompt;
  renderCategoryInput(item.categoryId);
  resetDialogImage();
  showModal($("#itemDialog"));
  if (item.image) {
    $("#itemImageStatus").textContent = t("imageLoading");
    const result = await cachedImage(item, () => isCurrentItemDialog(token, id), true);
    if (!isCurrentItemDialog(token, id) || dialogImageRequestToken !== imageRequestToken || itemDialogSaving) return;
    if (result.status === "ok" && result.blob) {
      const url = allocateImageUrl("dialog-" + id, result.blob, result.width, result.height);
      if (!isCurrentItemDialog(token, id) || dialogImageRequestToken !== imageRequestToken || itemDialogSaving) {
        revokeObjectUrl("dialog-" + id);
        return;
      }
      $("#itemImagePreview").src = url;
      $("#itemImagePreview").classList.remove("hidden");
      $("#itemImageStatus").textContent = item.image.width + "×" + item.image.height;
    } else {
      $("#itemImageStatus").textContent = statusLabel(result.status);
    }
  }
}

function resetDialogImage() {
  const preview = $("#itemImagePreview");
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  $("#itemImageStatus").textContent = t("noImage");
  $("#itemImageInput").value = "";
}

async function prepareDialogImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("请选择图片文件");
  const dialogToken = itemDialogToken;
  const dialogId = editingId;
  const requestToken = ++dialogImageRequestToken;
  dialogImageProcessing = true;
  pendingImage = null;
  clearDialogObjectUrls();
  resetDialogImage();
  updateItemDialogSaveState();
  $("#itemImageStatus").textContent = t("imageLoading");
  try {
    const processed = await processImageBlob(file);
    if (requestToken !== dialogImageRequestToken || !isCurrentItemDialog(dialogToken, dialogId) || itemDialogSaving) return;
    pendingImage = { ...processed, filename: file.name || "" };
    const key = "dialog-pending";
    const url = allocateImageUrl(key, base64ToBlob(processed.base64), processed.width, processed.height);
    $("#itemImagePreview").src = url;
    $("#itemImagePreview").classList.remove("hidden");
    $("#itemImageStatus").textContent = processed.width + "×" + processed.height;
    if (!$("#itemTitleInput").value.trim() && file.name) {
      $("#itemTitleInput").value = file.name.replace(/\.[a-z0-9]{1,8}$/i, "");
    }
  } catch (error) {
    if (requestToken !== dialogImageRequestToken || !isCurrentItemDialog(dialogToken, dialogId)) return;
    $("#itemImageStatus").textContent = error.message || t("operationFailed");
    throw error;
  } finally {
    if (requestToken === dialogImageRequestToken) {
      dialogImageProcessing = false;
      $("#itemImageInput").value = "";
      updateItemDialogSaveState();
    }
  }
}

async function saveDialogItem(event) {
  event.preventDefault();
  if (itemDialogSaving || dialogImageProcessing) return;
  const token = itemDialogToken;
  const itemId = editingId;
  const prompt = $("#itemPromptInput").value;
  let title = $("#itemTitleInput").value.trim();
  if (!title) {
    title = prompt.trim()
      ? generateTitleFromText(prompt)
      : (pendingImage && pendingImage.filename ? pendingImage.filename.replace(/\.[a-z0-9]{1,8}$/i, "") : "图片 " + new Date().toLocaleString());
  }
  const typedCategoryName = $("#itemCategoryInput").value.trim();
  const knownCategory = state.data.categories.find((category) => category.name === typedCategoryName);
  const categoryName = typedCategoryName === t("uncategorized") && !knownCategory ? "" : typedCategoryName;
  const categoryId = knownCategory ? knownCategory.id : UNCLASSIFIED_ID;
  setItemDialogBusy(true);
  try {
    if (itemId) {
      const item = { id: itemId, title, prompt, categoryId, categoryName };
      if (pendingImage) item.image = pendingImage;
      await send("item:update", { item });
    } else {
      await send("item:add", {
        item: {
          id: "item-" + crypto.randomUUID(),
          title,
          prompt,
          categoryId,
          categoryName,
          image: pendingImage || null
        }
      });
    }
    if (itemDialogToken !== token || editingId !== itemId) {
      await reloadState();
      return;
    }
    itemDialogClosingToken = itemDialogToken;
    const dialog = $("#itemDialog");
    dialog.close();
    restoreNoticeToApp(dialog);
    setItemDialogBusy(false);
    showNotice(t("saved"), "success");
    await reloadState();
  } finally {
    setItemDialogBusy(false);
  }
}

function isCurrentViewDialog(token, id = viewItemId) {
  return viewDialogToken === token && $("#viewDialog").open && viewItemId === id;
}

function closeViewDialog() {
  const dialog = $("#viewDialog");
  if (dialog.open) {
    viewDialogClosingToken = viewDialogToken;
    dialog.close();
    restoreNoticeToApp(dialog);
  }
}

async function openViewDialog(id) {
  const item = state.data.items.find((entry) => entry.id === id);
  if (!item) return;
  if ($("#viewDialog").open) closeViewDialog();
  viewDialogToken += 1;
  const token = viewDialogToken;
  clearViewObjectUrls();
  viewItemId = id;
  viewPromptText = item.prompt || "";
  $("#viewDialogTitle").textContent = item.title;
  $("#viewPrompt").textContent = viewPromptText || t("noPrompt");
  $("#viewPrompt").classList.toggle("muted", !item.prompt);
  $("#viewImageStatus").textContent = item.image ? t("imageLoading") : t("noImage");
  $("#viewImage").removeAttribute("src");
  $("#viewImage").classList.add("hidden");
  showModal($("#viewDialog"));
  setTimeout(() => {
    if (isCurrentViewDialog(token, id)) $("#closeViewBtn").focus();
  }, 0);
  if (!item.image) return;

  const result = await cachedImage(item, () => isCurrentViewDialog(token, id), true);
  if (!isCurrentViewDialog(token, id)) return;
  if (result.status !== "ok" || !result.blob) {
    $("#viewImageStatus").textContent = statusLabel(result.status);
    $("#viewImage").classList.add("hidden");
    return;
  }
  const key = "view-" + id;
  const url = allocateImageUrl(key, result.blob, result.width, result.height);
  if (!isCurrentViewDialog(token, id)) {
    revokeObjectUrl(key);
    return;
  }
  const image = $("#viewImage");
  image.alt = item.title;
  image.onerror = () => {
    if (!isCurrentViewDialog(token, id)) return;
    revokeObjectUrl(key);
    image.removeAttribute("src");
    image.classList.add("hidden");
    $("#viewImageStatus").textContent = t("imageCorrupt");
  };
  image.src = url;
  image.classList.remove("hidden");
  $("#viewImageStatus").textContent = item.image.width + "×" + item.image.height;
}

function renderListenButton() {
  if (!state) return;
  $("#listenBtn").classList.toggle("active", !!state.clipboardListening);
}

async function toggleClipboardListen() {
  const next = !state.clipboardListening;
  const result = await send("clipboard:setListen", { enabled: next });
  state.clipboardListening = result.listening;
  renderListenButton();
  showNotice(next ? t("listenStarted") : t("listenStopped"), next ? "success" : "info", next ? 4200 : 2600);
}

function renderStorageStatus() {
  if (!state) return;
  const isDirectory = state.settings.storageMode === "directory";
  const isNative = state.directory.provider === "native";
  const modeLabel = isNative ? t("nativeStorage") : t("directoryStorage");
  $("#storageHint").textContent = isDirectory
    ? modeLabel + (state.settings.directoryName ? " · " + state.settings.directoryName : "")
    : t("localStorage");
  $("#storageModeLabel").textContent = isDirectory ? modeLabel : t("localStorage");

  let statusText;
  if (!state.directory.configured) statusText = state.settings.language === "en" ? "No folder selected" : "未设置目录";
  else if (isNative && state.directory.permission === "unavailable") statusText = t("nativeUnavailable");
  else if (state.directory.permission === "granted" || state.directory.permission === "unknown") statusText = t("directoryGranted") + " · " + state.directory.name;
  else if (state.directory.permission === "prompt") statusText = t("directoryPrompt") + " · " + state.directory.name;
  else statusText = t("directoryDenied") + " · " + state.directory.name;
  $("#directoryStatusText").textContent = statusText;

  $("#reauthorizeBtn").classList.toggle(
    "hidden",
    isNative || !state.directory.configured || ["granted", "unknown"].includes(state.directory.permission)
  );
  $("#switchLocalBtn").classList.toggle("hidden", !isDirectory);

  $("#pendingBox").classList.toggle("hidden", !state.pendingCount);
  $("#pendingText").textContent = t("pending") + " " + state.pendingCount;

  if (state.readOnly) showNotice(t("readOnly"), "warning", 0, 10);
  else clearReadOnlyNotice();
}

function renderCategoryManager() {
  if (!state) return;
  const root = $("#categoryManager");
  root.replaceChildren();
  if (!state.data.categories.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = state.settings.language === "en" ? "No custom categories" : "还没有自定义分类";
    root.appendChild(empty);
    return;
  }
  for (const category of state.data.categories) {
    const row = document.createElement("div");
    row.className = "category-manage-row";
    const name = document.createElement("span");
    name.textContent = category.name;
    row.appendChild(name);
    const actions = document.createElement("div");
    actions.appendChild(createButton(state.settings.language === "en" ? "Rename" : "重命名", "", async () => {
      const next = prompt(state.settings.language === "en" ? "New category name" : "新的分类名称", category.name);
      if (!next || !next.trim() || next.trim() === category.name) return;
      await send("category:rename", { id: category.id, name: next.trim() });
      showNotice(t("categoryRenamed"), "success");
      await reloadState();
    }));
    actions.appendChild(createButton(t("delete"), "danger-ghost", async () => {
      const ok = confirm(state.settings.language === "en"
        ? "Delete this category? Its items will move to Uncategorized."
        : "删除这个分类？其中条目会移到“未分类”。");
      if (!ok) return;
      const wasActive = activeCategory() === category.id;
      await send("category:delete", { id: category.id });
      if (wasActive) await send("settings:update", { patch: { activeCategory: "all" } });
      showNotice(t("categoryDeleted"), "success");
      await reloadState();
    }));
    row.appendChild(actions);
    root.appendChild(row);
  }
}

function renderSettingsDialog() {
  renderStorageStatus();
  renderCategoryManager();
  $("#languageSelect").value = state.settings.language;
  $("#themeSelect").value = state.settings.theme;
}

async function chooseDirectory() {
  if (directoryConnecting) return;
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error(state.settings.language === "en"
      ? "This browser does not expose the File System Access API."
      : "当前浏览器未提供 File System Access API。");
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: "readwrite", id: "promptshelf-library" });
  } catch (error) {
    if (error && error.name === "AbortError") return;
    throw error;
  }
  await saveCandidateDirectoryHandle(handle);
  await configureChosenDirectory(handle);
}

async function configureChosenDirectory(handle) {
  const inspection = await send("directory:inspect");
  const rootId = handle.provider === "native" ? handle.rootId : null;
  if ((inspection.rootId || null) !== rootId) {
    throw new Error("待连接目录已被其他窗口改变，请重新选择");
  }
  if (!inspection.hasData) {
    const result = await send("directory:configure", { strategy: "migrate", rootId });
    savedDirectoryHandle = handle;
    showNotice(t("directoryReady") + " · " + result.count, "success");
    await reloadState();
    return;
  }
  // Explicitly reselecting the existing dataset via the bridge does not require
  // reading the expired browser handle. The selected on-disk data remains authoritative.
  const sameDataset = handle.provider === "native" && state.settings.storageMode === "directory" &&
    inspection.fingerprint === await datasetFingerprint(state.data);
  const strategy = sameDataset ? "use" : await askDirectoryChoice();
  if (!strategy) {
    await clearCandidateDirectoryHandle();
    await reloadState();
    return;
  }
  const result = await send("directory:configure", { strategy, rootId });
  savedDirectoryHandle = handle;
  showNotice(t("directoryReady") + " · " + result.count, "success");
  await reloadState();
}

async function connectNativeDirectory() {
  if (directoryConnecting) return;
  directoryConnecting = true;
  const buttons = [$("#connectNativeBtn"), $("#chooseDirectoryBtn")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const handle = await pickNativeDirectory();
    if (!handle) return;
    await saveCandidateDirectoryHandle(handle);
    await configureChosenDirectory(handle);
  } catch (error) {
    await clearCandidateDirectoryHandle();
    throw error;
  } finally {
    directoryConnecting = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function openStorageFolder() {
  if (state?.settings.storageMode === "directory" && savedDirectoryHandle?.provider === "native") {
    await savedDirectoryHandle.openInExplorer();
    return;
  }
  renderSettingsDialog();
  if (!$("#settingsDialog").open) showModal($("#settingsDialog"));
  showNotice(t("nativeHelp"), "info", 0);
  $("#connectNativeBtn").focus();
}

async function clearLocalStorage() {
  if (!state) return;
  const isDirectory = state.settings.storageMode === "directory";
  if (!confirm(isDirectory ? t("clearLocalConfirmDirectory") : t("clearLocalConfirmLocal"))) return;
  const result = await send("storage:clearLocal");
  showNotice(t("clearLocalDone") + " · " + (result.localItems || 0), "success", 2600);
  // Drop every in-memory dataset/cache and reinitialize from the now-empty storage.
  setTimeout(() => window.location.reload(), 700);
}

function askDirectoryChoice() {
  const dialog = $("#directoryChoiceDialog");
  showModal(dialog);
  return new Promise((resolve) => {
    directoryChoiceResolver = resolve;
  });
}

function resolveDirectoryChoice(value) {
  const dialog = $("#directoryChoiceDialog");
  dialog.close();
  restoreNoticeToApp(dialog);
  const resolve = directoryChoiceResolver;
  directoryChoiceResolver = null;
  if (resolve) resolve(value);
}

async function reauthorizeDirectory() {
  const handle = savedDirectoryHandle;
  if (!handle) throw new Error("没有保存的目录句柄");
  const status = await requestDirectoryPermission(handle, "readwrite");
  if (status !== "granted" && status !== "unknown") throw new Error(t("directoryDenied"));
  const result = await send("directory:reauthorized");
  showNotice(t("permissionGranted") + (result.remaining ? " · " + t("pending") + " " + result.remaining : ""), "success");
  await reloadState();
}

async function switchToLocal() {
  const ok = confirm(state.settings.language === "en"
    ? "Copy the current folder dataset into local extension storage and switch?"
    : "将当前目录数据完整迁移到扩展本地存储并切换？");
  if (!ok) return;
  const result = await send("storage:toLocal");
  showNotice(t("localReady") + " · " + result.count, "success");
  await reloadState();
}

async function exportZip() {
  if (archiveBusy) throw new Error("导入或导出正在进行，请等待完成");
  archiveBusy = true;
  try {
    const bundle = await send("export:get");
    const blob = await buildZipBlob(bundle);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    anchor.href = url;
    anchor.download = "promptsave-" + stamp + ".zip";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const suffix = bundle.missing && bundle.missing.length
      ? (state.settings.language === "en" ? " · missing images " : " · 缺失图片 ") + bundle.missing.length
      : "";
    showNotice(t("exportDone") + suffix, "success");
  } finally { archiveBusy = false; }
}

async function importZip(file) {
  if (archiveBusy) throw new Error("导入或导出正在进行，请等待完成");
  archiveBusy = true;
  try {
    // ZIP parsing may outlast transient activation; obtain folder permission before parsing.
    await authorizeDirectoryForAction("import:apply");
    const mode = $("#importMode").value === "replace" ? "replace" : "merge";
    const bundle = await parseZipFile(file);
    if (mode === "replace" && !confirm(t("confirmReplace"))) return;
    const result = await send("import:apply", { bundle, mode });
    const added = Number(result && result.added != null ? result.added : result && result.count || 0);
    const skipped = Number(result && result.skipped || 0);
    const repaired = Number(result && result.repaired || 0);
    const importStats = [
      t("added") + " " + added,
      t("skipped") + " " + skipped
    ];
    if (repaired) importStats.push(t("repaired") + " " + repaired);
    showNotice(t("importDone") + " · " + importStats.join(" · "), "success");
    $("#importFileInput").value = "";
    await reloadState();
  } finally { archiveBusy = false; }
}

async function runImageCheck(deep) {
  if (deep) await reloadState(true);
  if (!state || state.settings.storageMode !== "directory") {
    if (deep) showNotice(t("checked"), "success");
    return;
  }
  const ids = deep
    ? state.data.items.filter((item) => item.image).map((item) => item.id)
    : [...renderedImageIds];
  if (!ids.length) {
    if (deep) showNotice(t("checked"), "success");
    return;
  }
  const statuses = await send("images:check", { ids, deep: !!deep });
  let changed = false;
  for (const item of state.data.items) {
    if (!item.image || !Object.prototype.hasOwnProperty.call(statuses, item.image.id)) continue;
    const previous = imageStatuses.get(item.id);
    const next = statuses[item.image.id];
    if (previous !== next) changed = true;
    imageStatuses.set(item.id, next);
  }
  if (changed) renderItems();
  if (deep) showNotice(t("checked"), "success");
}

function handleError(error) {
  if (error?.name === "AbortError") return;
  console.error(error);
  send("debug:record", { code: error?.code || error?.name || "UNKNOWN_ERROR" }).catch(() => {});
  showNotice(error && error.message ? error.message : t("operationFailed"), "error", 6000);
}

function bindEvents() {
  $("#listenBtn").addEventListener("click", () => toggleClipboardListen().catch(handleError));
  $("#openDirectoryBtn").addEventListener("click", () => openStorageFolder().catch(handleError));
  $("#clearLocalBtn").addEventListener("click", () => clearLocalStorage().catch(handleError));
  $("#openFullBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html?full=1") }).catch(handleError);
  });
  $("#brandMark").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com/baize7815/PromptSave" }).catch(handleError);
  });
  $("#refreshBtn").addEventListener("click", () => runImageCheck(true).catch(handleError));
  $("#batchBtn").addEventListener("click", () => {
    batchMode = !batchMode;
    clearSelection();
    renderBatchBar();
    renderItems();
  });
  $("#viewBtn").addEventListener("click", async () => {
    const view = state.settings.view === "list" ? "grid" : "list";
    state.settings.view = view;
    await send("settings:update", { patch: { view } });
    renderItems();
  });
  $("#settingsBtn").addEventListener("click", () => {
    renderSettingsDialog();
    showModal($("#settingsDialog"));
  });
  $("#addBtn").addEventListener("click", () => openAddDialog().catch(handleError));

  $("#searchInput").addEventListener("input", () => {
    visibleOffset = 0;
    clearSelection();
    visibleLimit = pageSize();
    renderItems();
  });
  $("#sortSelect").addEventListener("change", async () => {
    visibleOffset = 0;
    state.settings.sort = $("#sortSelect").value;
    clearSelection();
    await send("settings:update", { patch: { sort: state.settings.sort } });
    renderItems();
  });
  $("#loadMoreBtn").addEventListener("click", () => {
    visibleOffset += visibleLimit;
    renderItems();
    $("#cards").scrollIntoView({ block: "start" });
  });
  $("#previousPageBtn").addEventListener("click", () => {
    visibleOffset = Math.max(0, visibleOffset - visibleLimit);
    renderItems();
    $("#cards").scrollIntoView({ block: "start" });
  });

  $("#selectAllCheckbox").addEventListener("change", () => {
    const items = filteredItems();
    if ($("#selectAllCheckbox").checked) {
      for (const item of items) selectedIds.add(item.id);
    } else {
      clearSelection();
    }
    renderBatchBar();
    renderItems();
  });
  $("#batchMoveBtn").addEventListener("click", async () => {
    if (!selectedIds.size) return;
    const result = await send("items:bulkCategory", {
      ids: [...selectedIds],
      categoryId: $("#batchCategorySelect").value
    });
    clearSelection();
    showNotice((state.settings.language === "en" ? "Moved " : "已修改分类 ") + result.count, "success");
    await reloadState();
  });
  $("#batchDeleteBtn").addEventListener("click", async () => {
    if (!selectedIds.size) return;
    if (activeCategory() === "trash") {
      if (!confirm(t("confirmPermanent"))) return;
      const ids = [...selectedIds];
      let failed = 0;
      for (const id of ids) {
        try {
          await send("item:deletePermanent", { id });
        } catch (_) {
          failed += 1;
        }
      }
      clearSelection();
      showNotice(failed ? (state.settings.language === "en" ? "Failed " : "失败 ") + failed : t("deleted"), failed ? "error" : "success");
      await reloadState();
      return;
    }
    if (!confirm(t("confirmDelete"))) return;
    const result = await send("items:softDelete", { ids: [...selectedIds] });
    clearSelection();
    showNotice(t("movedTrash") + " · " + result.count, "success");
    await reloadState();
  });
  $("#batchCancelBtn").addEventListener("click", () => {
    batchMode = false;
    clearSelection();
    renderBatchBar();
    renderItems();
  });

  $("#itemForm").addEventListener("submit", (event) => saveDialogItem(event).catch(handleError));
  $("#itemDialog").addEventListener("cancel", (event) => {
    if (itemDialogSaving) event.preventDefault();
    else itemDialogClosingToken = itemDialogToken;
  });
  $("#itemDialog").addEventListener("close", () => {
    if ($("#itemDialog").open || itemDialogClosingToken !== itemDialogToken) return;
    itemDialogClosingToken = null;
    itemDialogToken += 1;
    dialogImageRequestToken += 1;
    dialogImageProcessing = false;
    editingId = null;
    pendingImage = null;
    clearDialogObjectUrls();
    resetDialogImage();
    restoreNoticeToApp($("#itemDialog"));
  });
  $("#cancelItemBtn").addEventListener("click", closeItemDialog);
  $("#closeItemBtn").addEventListener("click", closeItemDialog);
  $("#itemImageInput").addEventListener("change", () => {
    const file = $("#itemImageInput").files && $("#itemImageInput").files[0];
    if (file) prepareDialogImage(file).catch(handleError);
  });
  $("#copyFromDialogBtn").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#itemPromptInput").value);
    showNotice(t("copied"), "success", 1500);
  });

  document.addEventListener("paste", (event) => {
    if (!$("#itemDialog").open) return;
    const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type && entry.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      event.preventDefault();
      prepareDialogImage(file).catch(handleError);
    }
  });

  $("#viewDialog").addEventListener("close", () => {
    if ($("#viewDialog").open || viewDialogClosingToken !== viewDialogToken) return;
    viewDialogClosingToken = null;
    viewDialogToken += 1;
    viewItemId = null;
    viewPromptText = "";
    clearViewObjectUrls();
    $("#viewImage").onerror = null;
    $("#viewImage").removeAttribute("src");
    $("#viewImage").classList.add("hidden");
    restoreNoticeToApp($("#viewDialog"));
  });
  $("#viewDialog").addEventListener("cancel", () => {
    viewDialogClosingToken = viewDialogToken;
  });
  $("#closeViewBtn").addEventListener("click", closeViewDialog);
  $("#copyViewBtn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(viewPromptText);
    showNotice(t("copied"), "success", 1500);
  });
  $("#editViewBtn").addEventListener("click", () => {
    const id = viewItemId;
    closeViewDialog();
    if (id) openEditDialog(id).catch(handleError);
  });

  $("#settingsDialog").addEventListener("close", () => {
    if (!$("#settingsDialog").open) restoreNoticeToApp($("#settingsDialog"));
  });
  $("#directoryChoiceDialog").addEventListener("close", () => {
    if (!$("#directoryChoiceDialog").open) restoreNoticeToApp($("#directoryChoiceDialog"));
  });
  $("#directoryChoiceDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    resolveDirectoryChoice(null);
  });
  $("#closeSettingsBtn").addEventListener("click", () => {
    const dialog = $("#settingsDialog");
    dialog.close();
    restoreNoticeToApp(dialog);
  });
  $("#chooseDirectoryBtn").addEventListener("click", () => chooseDirectory().catch(handleError));
  $("#connectNativeBtn").addEventListener("click", () => connectNativeDirectory().catch(handleError));
  $("#reauthorizeBtn").addEventListener("click", () => reauthorizeDirectory().catch(handleError));
  $("#switchLocalBtn").addEventListener("click", () => switchToLocal().catch(handleError));
  $("#retryPendingBtn").addEventListener("click", async () => {
    const result = await send("pending:retry");
    showNotice(t("pendingDone") + " · " + result.completed, "success");
    await reloadState();
  });

  $("#newCategoryBtn").addEventListener("click", async () => {
    const name = $("#newCategoryInput").value.trim();
    if (!name) return;
    await send("category:add", { category: { id: "cat-" + crypto.randomUUID(), name } });
    $("#newCategoryInput").value = "";
    showNotice(t("categoryAdded"), "success");
    await reloadState();
  });
  $("#newCategoryInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("#newCategoryBtn").click();
    }
  });

  $("#languageSelect").addEventListener("change", async () => {
    state.settings.language = $("#languageSelect").value === "en" ? "en" : "zh";
    await send("settings:update", { patch: { language: state.settings.language } });
    applyLanguage();
    renderCategories();
    renderItems();
    renderStorageStatus();
    renderCategoryManager();
  });
  $("#themeSelect").addEventListener("change", async () => {
    state.settings.theme = $("#themeSelect").value === "dark" ? "dark" : "light";
    await send("settings:update", { patch: { theme: state.settings.theme } });
    applyTheme();
  });
  $("#debugPageBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("debug.html") }).catch(handleError);
  });

  $("#exportBtn").addEventListener("click", () => exportZip().catch(handleError));
  $("#importFileInput").addEventListener("change", () => {
    const file = $("#importFileInput").files && $("#importFileInput").files[0];
    if (file) importZip(file).catch((error) => {
      $("#importFileInput").value = "";
      handleError(error);
    });
  });

  $("#useDirectoryDataBtn").addEventListener("click", () => resolveDirectoryChoice("use"));
  $("#mergeDirectoryDataBtn").addEventListener("click", () => resolveDirectoryChoice("merge"));
  $("#cancelDirectoryChoiceBtn").addEventListener("click", () => resolveDirectoryChoice(null));

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.event === "captureFeedback") {
      showCaptureFeedback(message.feedback);
      return;
    }
    if (message && message.event === "dataChanged") {
      if (reloadPromise) reloadAgain = true;
      if (document.visibilityState === "visible") reloadState().catch(handleError);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      reloadState(true).catch(handleError);
      return;
    }
    imageCache.clear();
    if (imageObserver) imageObserver.disconnect();
    revokeObjectUrls((key) => key.startsWith("card-"));
    for (const node of document.querySelectorAll(".card-image")) node.textContent = t("imageLoading");
  });

  window.addEventListener("beforeunload", () => {
    imageCache.clear();
    revokeObjectUrls();
    if (imageObserver) imageObserver.disconnect();
  });
}

applyLanguage();
bindEvents();
reloadState().catch(handleError);

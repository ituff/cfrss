/**
 * Internationalization (i18n) module for the RSS Reader client.
 * Supports zh (Chinese) and en (English) with dynamic switching.
 */

import { detectLanguage, type SupportedLanguage } from '../../utils/language';
import { getDeviceId } from './device.js';

export type { SupportedLanguage } from '../../utils/language';

export type TranslationKey = keyof typeof translations.en;

type LanguageChangeListener = (lang: SupportedLanguage) => void;

/**
 * All UI translation keys organized by category.
 * Every key must exist in both zh and en.
 */
export const translations: Record<SupportedLanguage, Record<string, string>> = {
  zh: {
    // Navigation
    home: '首页',
    subscriptions: '订阅',
    articles: '文章',
    settings: '设置',

    // Actions
    add: '添加',
    delete: '删除',
    edit: '编辑',
    save: '保存',
    cancel: '取消',
    refresh: '刷新',
    retry: '重试',
    skip: '跳过',
    confirm: '确认',

    // Subscriptions
    add_subscription: '添加订阅',
    delete_subscription: '删除订阅',
    move_to_category: '移动到分类',
    no_subscriptions: '暂无订阅',

    // Categories
    add_category: '添加分类',
    rename_category: '重命名分类',
    delete_category: '删除分类',
    uncategorized: '未分类',

    // Articles
    no_articles: '暂无文章',
    no_unread: '暂无未读文章',
    mark_read: '标记已读',
    mark_unread: '标记未读',
    unread: '未读',
    no_more_articles: '没有更多文章了',

    // LLM
    summarize: '总结',
    translate: '翻译',
    read_aloud: '朗读',
    generating: '生成中…',
    translating: '翻译中…',
    show_original: '显示原文',

    // Digest
    daily_digest: '每日摘要',
    no_new_content: '今日暂无新内容',
    loading_digest: '正在生成摘要…',

    // Settings
    theme: '主题',
    language: '语言',
    llm_config: 'LLM 配置',
    github_config: 'GitHub 配置',

    // Theme
    light: '浅色',
    dark: '深色',
    oled: 'OLED 纯黑',
    eink: '墨水屏纯白',

    // Errors
    timeout: '请求超时',
    network_error: '网络错误',
    not_found: '未找到',
    validation_error: '验证错误',

    // OPML
    import_opml: '导入 OPML',
    export_opml: '导出 OPML',
    import_success: '导入成功',
    import_failed: '导入失败',

    // PWA
    offline_mode: '离线模式',
    update_available: '有新版本可用',
    refresh_to_update: '刷新以更新',

    // Auth
    login_title: 'CF RSS Reader',
    login_subtitle: '请输入访问令牌登录',
    login_token_placeholder: '访问令牌',
    login_button: '登录',
    login_verifying: '验证中…',
    login_error: '令牌无效，请重试',
    marked_abnormal: '该订阅源连续多次拉取失败，已被标记为异常并暂停更新。可在设置中重新启用。',
    all_articles: '全部文章',
    unread_only: '仅看未读',
    all: '全部',
    select_article_hint: '选择一篇文章开始阅读',
    time_now: '刚刚',
    time_minutes: '分钟前',
    time_hours: '小时前',
    time_days: '天前',
    digest: '摘要',
    enable: '重新启用',
    settings_theme_desc: '切换浅色 / 深色 / OLED 纯黑 / 墨水屏纯白主题',
    settings_language_desc: '选择界面显示语言',
    settings_llm_desc: '配置用于文章总结与翻译的 AI 模型',
    settings_github_desc: '文章正文归档到的 GitHub 仓库',
    edit_subscription: '编辑订阅',

    // Password
    password: '访问密码',
    settings_password_desc: '修改登录本应用的访问密码',
    password_current: '当前密码',
    password_new: '新密码',
    password_confirm: '确认新密码',
    password_save: '修改密码',
    password_reset: '恢复为初始令牌',
    password_success: '密码修改成功，本机已自动登录。',
    password_reset_success: '已恢复为服务器初始令牌。',
    password_error_short: '新密码至少 6 位。',
    password_error_mismatch: '两次输入的新密码不一致。',
    password_error_current: '当前密码不正确。',
    password_error_current_required: '请输入当前密码。',
    password_error_generic: '操作失败，请稍后重试。',

    // Mobile article list
    favorites: '收藏',
    select_all: '全选',
    mark_all_read: '全部标为已读',
    unread_count: '未读',

    // Bookmarks (收藏)
    bookmarks: '收藏',
    bookmark_add: '收藏文章',
    bookmark_remove: '取消收藏',
    bookmark_save_failed: '收藏失败，请重试。',
    bookmarks_empty: '暂无收藏',
    bookmarks_hint: '在文章页点击收藏按钮，文章会出现在这里',
    load_bookmarks_failed: '收藏加载失败，请重试。',
    remove_bookmark_failed: '取消收藏失败，请重试。',
    bookmarked_at: '收藏于',

    // Loading / error states
    loading: '加载中…',
    load_articles_failed: '文章加载失败，请重试。',
    load_article_failed: '文章内容加载失败，请重试。',
    connection_failed: '连接失败',
    playback_failed: '播放失败',
    load_failed: '加载失败',
    delete_failed: '删除失败',
    export_failed: '导出失败',
    dismiss: '关闭',
    network_request_failed: '网络请求失败',
    request_failed: '请求失败',
    loading_article: '正在加载文章…',

    // A11y labels
    main_navigation: '主导航',
    feeds: '订阅源',
    collapse: '折叠',
    expand: '展开',
    article_list_label: '文章列表',
    summary_label: '文章摘要',
    translation_label: '文章翻译',
    read_aloud_player_label: '朗读播放器',

    // Player
    pause: '暂停',
    resume: '继续',
    stop: '停止',
    no_previous_article: '没有更早的文章了',
    tts_unconfigured: '请先在设置中配置朗读服务',
    tts_request_failed: '语音合成请求失败',

    // Translation panel
    original_content: '原文',
    translated_content: '译文',
    mode_dual: '双行对照',
    mode_side_by_side: '左右对照',
    mode_replace: '仅译文',
    switch_to_dual: '切换为双行对照',
    switch_to_side_by_side: '切换为左右对照',
    switch_to_replace: '切换为仅显示译文',
    target_language: '目标语言',

    // Generic settings fields
    test: '测试',
    function_assignments: '功能分配',
    no_llm_configs: '暂无 LLM 配置',
    none_option: '— 无 —',
    field_name: '名称',
    field_base_url: '接口地址',
    field_api_key: 'API 密钥',
    field_model: '模型',
    placeholder_name: '我的 LLM 配置',
    test_ok: '成功',
    test_failed: '失败',
    connection_success: '连接成功',
    current_token_hint: '当前令牌',
    error_name_required: '名称不能为空',
    error_base_url_required: '接口地址不能为空',
    error_base_url_https: '接口地址必须以 https:// 开头',
    error_api_key_required: 'API 密钥不能为空',
    error_model_required: '模型名称不能为空',
    error_repo_owner_required: '仓库所有者不能为空',
    error_repo_name_required: '仓库名称不能为空',
    error_branch_required: '分支不能为空',
    error_content_path_required: '内容目录不能为空',
    field_repo_owner: '仓库所有者',
    field_repo_name: '仓库名称',
    field_token: '访问令牌 (PAT)',
    field_branch: '分支',
    field_content_path: '内容目录',
    field_feed_url: '订阅地址',
    field_subscription_title: '订阅名称',
    error_title_required: '订阅名称不能为空',
    error_url_required: '订阅地址不能为空',
    error_url_too_long: '订阅地址超过 2048 个字符',
    error_url_protocol: '订阅地址必须以 http:// 或 https:// 开头',

    // OPML import
    choose_opml_file: '选择 OPML 文件',
    opml_hint: '支持 .opml 或 .xml 文件，最大 5MB',
    importing_subscriptions: '正在导入订阅…',
    import_another: '继续导入',
    file_too_large: '文件过大，最大支持 5MB',
    invalid_file_type: '文件类型无效，请选择 .opml 或 .xml 文件',
    imported_count: '成功导入',
    skipped_count: '已跳过',
    failed_count: '失败',

    // Pull to refresh
    pull_to_refresh: '↓ 下拉刷新',
    release_to_refresh: '↓ 释放即可刷新',
    refreshing: '⟳ 正在刷新…',

    // TTS (read-aloud) configuration
    tts_config: '朗读配置',
    settings_tts_desc: '配置文章朗读服务的地址、密钥与音色',
    field_tts_url: '服务地址',
    field_tts_token: 'API KEY',
    field_tts_voice: '音色',
    tts_voice_auto: '自动识别（按语言）',
    tts_voice_auto_hint: '自动识别时会根据每段文字的语言选择音色；手动指定后全文使用同一音色',
    tts_voice_manual_hint: '全文将使用所选音色朗读，不再按语言自动切换',
    tts_voice_zh_cn: '普通话（大陆）',
    tts_voice_zh_hk: '粤语（中国香港）',
    tts_voice_zh_tw: '国语（中国台湾）',
    tts_voice_en: '英语',
    tts_voice_other: '其他语言',
    tts_token_saved_hint: '已保存密钥，输入可替换',
    tts_save_success: '朗读配置已保存',
    tts_test_success: '语音服务连接成功',
    error_tts_url_protocol: '服务地址必须以 http(s):// 开头',
  },
  en: {
    // Navigation
    home: 'Home',
    subscriptions: 'Subscriptions',
    articles: 'Articles',
    settings: 'Settings',

    // Actions
    add: 'Add',
    delete: 'Delete',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    refresh: 'Refresh',
    retry: 'Retry',
    skip: 'Skip',
    confirm: 'Confirm',

    // Subscriptions
    add_subscription: 'Add Subscription',
    delete_subscription: 'Delete Subscription',
    move_to_category: 'Move to Category',
    no_subscriptions: 'No subscriptions yet',

    // Categories
    add_category: 'Add Category',
    rename_category: 'Rename Category',
    delete_category: 'Delete Category',
    uncategorized: 'Uncategorized',

    // Articles
    no_articles: 'No articles yet',
    no_unread: 'No unread articles',
    mark_read: 'Mark as Read',
    mark_unread: 'Mark as Unread',
    unread: 'Unread',
    no_more_articles: 'No more articles',

    // LLM
    summarize: 'Summarize',
    translate: 'Translate',
    read_aloud: 'Read Aloud',
    generating: 'Generating…',
    translating: 'Translating…',
    show_original: 'Show Original',

    // Digest
    daily_digest: 'Daily Digest',
    no_new_content: 'No new content today',
    loading_digest: 'Generating digest…',

    // Settings
    theme: 'Theme',
    language: 'Language',
    llm_config: 'LLM Config',
    github_config: 'GitHub Config',

    // Theme
    light: 'Light',
    dark: 'Dark',
    oled: 'OLED Black',
    eink: 'E-Ink White',

    // Errors
    timeout: 'Request Timeout',
    network_error: 'Network Error',
    not_found: 'Not Found',
    validation_error: 'Validation Error',

    // OPML
    import_opml: 'Import OPML',
    export_opml: 'Export OPML',
    import_success: 'Import Successful',
    import_failed: 'Import Failed',

    // PWA
    offline_mode: 'Offline Mode',
    update_available: 'Update Available',
    refresh_to_update: 'Refresh to Update',

    // Auth
    login_title: 'CF RSS Reader',
    login_subtitle: 'Enter your access token to sign in',
    login_token_placeholder: 'Access token',
    login_button: 'Sign In',
    login_verifying: 'Verifying…',
    login_error: 'Invalid token, please try again',
    marked_abnormal: 'This feed failed to refresh repeatedly and has been marked abnormal. Re-enable it in settings.',
    all_articles: 'All Articles',
    unread_only: 'Unread only',
    all: 'All',
    select_article_hint: 'Select an article to start reading',
    time_now: 'just now',
    time_minutes: 'min ago',
    time_hours: 'hr ago',
    time_days: 'd ago',
    digest: 'Digest',
    enable: 'Re-enable',
    settings_theme_desc: 'Switch between light, dark, OLED black and e-ink themes',
    settings_language_desc: 'Choose the interface language',
    settings_llm_desc: 'Configure AI models for summarize and translate',
    settings_github_desc: 'GitHub repository where article content is archived',
    edit_subscription: 'Edit subscription',

    // Password
    password: 'Access Password',
    settings_password_desc: 'Change the password used to sign in to this app',
    password_current: 'Current password',
    password_new: 'New password',
    password_confirm: 'Confirm new password',
    password_save: 'Change password',
    password_reset: 'Restore initial token',
    password_success: 'Password changed. This device stays signed in.',
    password_reset_success: 'Restored the server bootstrap token.',
    password_error_short: 'New password must be at least 6 characters.',
    password_error_mismatch: 'The two new passwords do not match.',
    password_error_current: 'Current password is incorrect.',
    password_error_current_required: 'Please enter the current password.',
    password_error_generic: 'Operation failed, please try again later.',

    // Mobile article list
    favorites: 'Favorites',
    select_all: 'Select all',
    mark_all_read: 'Mark all as read',
    unread_count: 'Unread',

    // Bookmarks (收藏)
    bookmarks: 'Bookmarks',
    bookmark_add: 'Bookmark this article',
    bookmark_remove: 'Remove bookmark',
    bookmark_save_failed: 'Failed to bookmark. Please try again.',
    bookmarks_empty: 'No bookmarks yet',
    bookmarks_hint: 'Tap the bookmark button on an article and it will show up here',
    load_bookmarks_failed: 'Failed to load bookmarks. Please try again.',
    remove_bookmark_failed: 'Failed to remove bookmark. Please try again.',
    bookmarked_at: 'Saved',

    // Loading / error states
    loading: 'Loading…',
    load_articles_failed: 'Failed to load articles. Please try again.',
    load_article_failed: 'Failed to load article. Please try again.',
    connection_failed: 'Connection failed',
    playback_failed: 'Playback failed',
    load_failed: 'Load failed',
    delete_failed: 'Delete failed',
    export_failed: 'Export failed',
    dismiss: 'Dismiss',
    network_request_failed: 'Network request failed',
    request_failed: 'Request failed',
    loading_article: 'Loading article…',

    // A11y labels
    main_navigation: 'Main navigation',
    feeds: 'Feeds',
    collapse: 'Collapse',
    expand: 'Expand',
    article_list_label: 'Article list',
    summary_label: 'Article summary',
    translation_label: 'Article translation',
    read_aloud_player_label: 'Read aloud player',

    // Player
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    no_previous_article: 'No previous article',
    tts_unconfigured: 'Configure the read-aloud service in Settings first',
    tts_request_failed: 'TTS request failed',

    // Translation panel
    original_content: 'Original',
    translated_content: 'Translation',
    mode_dual: 'Dual-line',
    mode_side_by_side: 'Side by side',
    mode_replace: 'Translation only',
    switch_to_dual: 'Switch to dual-line view',
    switch_to_side_by_side: 'Switch to side-by-side view',
    switch_to_replace: 'Switch to translation-only view',
    target_language: 'Target language',

    // Generic settings fields
    test: 'Test',
    function_assignments: 'Function Assignments',
    no_llm_configs: 'No LLM configurations yet',
    none_option: '— None —',
    field_name: 'Name',
    field_base_url: 'Base URL',
    field_api_key: 'API Key',
    field_model: 'Model',
    placeholder_name: 'My LLM Config',
    test_ok: 'OK',
    test_failed: 'Failed',
    connection_success: 'Connection successful',
    current_token_hint: 'Current token',
    error_name_required: 'Name is required',
    error_base_url_required: 'Base URL is required',
    error_base_url_https: 'Base URL must start with https://',
    error_api_key_required: 'API Key is required',
    error_model_required: 'Model name is required',
    error_repo_owner_required: 'Repository owner is required',
    error_repo_name_required: 'Repository name is required',
    error_branch_required: 'Branch is required',
    error_content_path_required: 'Content path is required',
    field_repo_owner: 'Repository Owner',
    field_repo_name: 'Repository Name',
    field_token: 'Personal Access Token',
    field_branch: 'Branch',
    field_content_path: 'Content Path',
    field_feed_url: 'Feed URL',
    field_subscription_title: 'Subscription name',
    error_title_required: 'Title is required',
    error_url_required: 'URL is required',
    error_url_too_long: 'URL exceeds 2048 characters',
    error_url_protocol: 'URL must start with http:// or https://',

    // OPML import
    choose_opml_file: 'Choose OPML File',
    opml_hint: 'Accepts .opml or .xml files (max 5MB)',
    importing_subscriptions: 'Importing subscriptions…',
    import_another: 'Import Another',
    file_too_large: 'File too large. Maximum size is 5MB.',
    invalid_file_type: 'Invalid file type. Please select an .opml or .xml file.',
    imported_count: 'Imported',
    skipped_count: 'Skipped',
    failed_count: 'Failed',

    // Pull to refresh
    pull_to_refresh: '↓ Pull to refresh',
    release_to_refresh: '↓ Release to refresh',
    refreshing: '⟳ Refreshing…',

    // TTS (read-aloud) configuration
    tts_config: 'Read Aloud (TTS)',
    settings_tts_desc: 'Configure the text-to-speech service URL, key and voice',
    field_tts_url: 'Service URL',
    field_tts_token: 'API Key',
    field_tts_voice: 'Voice',
    tts_voice_auto: 'Auto (by language)',
    tts_voice_auto_hint: 'Auto picks a voice from each paragraph\'s language; a manual choice reads the whole article in one voice',
    tts_voice_manual_hint: 'The whole article will be read in the selected voice, without switching by language',
    tts_voice_zh_cn: 'Mandarin (Mainland China)',
    tts_voice_zh_hk: 'Cantonese (Hong Kong, China)',
    tts_voice_zh_tw: 'Mandarin (Taiwan, China)',
    tts_voice_en: 'English',
    tts_voice_other: 'Other languages',
    tts_token_saved_hint: 'A key is saved; type to replace it',
    tts_save_success: 'TTS configuration saved',
    tts_test_success: 'TTS service connected',
    error_tts_url_protocol: 'Service URL must start with http(s)://',
  },
};

/** Current active language */
let currentLanguage: SupportedLanguage = 'en';

/** Registered language change listeners */
const listeners: Set<LanguageChangeListener> = new Set();

/**
 * Mirror the active language onto `<html lang>`.
 *
 * `index.html` hardcodes `lang="en"` so the first paint is labelled correctly
 * for the default locale — but nothing updated it afterwards. A UI switched to
 * Chinese therefore still claimed to be English: screen readers announced it
 * with English phonetics, and the browser applied English font-selection and
 * line-breaking rules to CJK text. Idempotent, so it is safe to call on every
 * language resolution.
 */
function syncDocumentLanguage(lang: SupportedLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement?.setAttribute('lang', lang);
}

/**
 * Initialize the i18n module.
 * Auto-detects language from navigator.language if available.
 */
export function initI18n(navigatorLang?: string): void {
  const lang = navigatorLang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  currentLanguage = detectLanguage(lang);
  syncDocumentLanguage(currentLanguage);
}

/**
 * Get the translation for a given key in the current language.
 * Returns the key itself if no translation is found.
 */
export function t(key: string): string {
  const dict = translations[currentLanguage];
  return dict[key] ?? key;
}

/**
 * Switch the active language without page reload.
 * Notifies all registered listeners of the change.
 * Persistence to Config_Store is a separate concern — the settings UI
 * calls persistLanguage() explicitly.
 */
export function setLanguage(lang: SupportedLanguage): void {
  // Before the equality check: the server can resolve the same language the
  // page already had, and <html lang> still needs to be correct.
  syncDocumentLanguage(lang);
  if (lang === currentLanguage) return;
  currentLanguage = lang;
  for (const listener of listeners) {
    listener(lang);
  }
}

/**
 * Device identification header, so theme/language preferences are stored and
 * resolved per device (an e-reader and an iPad can differ).
 */
function deviceHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { 'X-Device-Id': id } : {};
}

/**
 * Persist the language preference to the server (Config_Store), scoped to
 * this device. Failures are silently ignored — the UI has already switched.
 */
export async function persistLanguage(lang: SupportedLanguage): Promise<void> {
  try {
    await fetch('/api/config/language', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...deviceHeaders() },
      body: JSON.stringify({ language: lang }),
    });
  } catch {
    // Silently fail — i18n module already switched
  }
}

/**
 * Load the language preference from the server (Config_Store) and apply it.
 *
 * The server resolves this device's language first and falls back to the
 * global value. When no preference is stored (or the request fails), the
 * auto-detected navigator language stays active.
 * Call once during app bootstrap, before the first render.
 */
export async function loadLanguageFromServer(): Promise<void> {
  try {
    const res = await fetch('/api/config/language', { headers: deviceHeaders() });
    if (res.ok) {
      const data = (await res.json()) as { language: SupportedLanguage | null };
      if (data.language === 'zh' || data.language === 'en') {
        setLanguage(data.language);
      }
    }
  } catch {
    // Use auto-detected language — degradation strategy
  }
}

/**
 * Get the current active language.
 */
export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

/**
 * Register a callback to be notified when language changes.
 * Returns an unsubscribe function.
 */
export function onLanguageChange(listener: LanguageChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Get all registered translation keys.
 */
export function getTranslationKeys(): string[] {
  return Object.keys(translations.en);
}

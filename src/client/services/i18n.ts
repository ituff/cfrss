/**
 * Internationalization (i18n) module for the RSS Reader client.
 * Supports zh (Chinese) and en (English) with dynamic switching.
 */

import { detectLanguage, type SupportedLanguage } from '../../utils/language';

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
    settings_theme_desc: '切换浅色 / 深色主题，跟随系统偏好',
    settings_language_desc: '选择界面显示语言',
    settings_llm_desc: '配置用于文章总结与翻译的 AI 模型',
    settings_github_desc: '文章正文归档到的 GitHub 仓库',
    edit_subscription: '编辑订阅',
    edit_title: '请输入新标题：',
    edit_url: '请输入新的 RSS 地址：',
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
    settings_theme_desc: 'Switch between light and dark themes',
    settings_language_desc: 'Choose the interface language',
    settings_llm_desc: 'Configure AI models for summarize and translate',
    settings_github_desc: 'GitHub repository where article content is archived',
    edit_subscription: 'Edit subscription',
    edit_title: 'Enter the new title:',
    edit_url: 'Enter the new RSS URL:',
  },
};

/** Current active language */
let currentLanguage: SupportedLanguage = 'en';

/** Registered language change listeners */
const listeners: Set<LanguageChangeListener> = new Set();

/**
 * Initialize the i18n module.
 * Auto-detects language from navigator.language if available.
 */
export function initI18n(navigatorLang?: string): void {
  const lang = navigatorLang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  currentLanguage = detectLanguage(lang);
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
 */
export function setLanguage(lang: SupportedLanguage): void {
  if (lang === currentLanguage) return;
  currentLanguage = lang;
  for (const listener of listeners) {
    listener(lang);
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

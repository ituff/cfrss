/**
 * RouteView — mounts the real feature component for the active route into a
 * container element and tears down the previous one on navigation.
 * Shared by DesktopLayout and MobileLayout so both layouts render the same
 * views with the same lifecycle handling.
 */

import { Route } from '../router.js';
import { navigate } from '../router.js';
import { getCurrentArticleId } from '../state.js';
import { t } from '../services/i18n.js';
import { DailyDigestCard } from './digest/DailyDigestCard.js';
import { SubscriptionList } from './subscription/SubscriptionList.js';
import { ArticleView } from './article/ArticleView.js';
import { BookmarksView } from './bookmark/BookmarksView.js';
import { MobileArticleList } from './mobile/MobileArticleList.js';
import { ThemeToggle } from './settings/ThemeToggle.js';
import { LanguageSwitch } from './settings/LanguageSwitch.js';
import { LLMConfigPanel } from './settings/LLMConfigPanel.js';
import { GitHubConfigPanel } from './settings/GitHubConfigPanel.js';
import { TTSConfigPanel } from './settings/TTSConfigPanel.js';
import { PasswordPanel } from './settings/PasswordPanel.js';

interface Mountable {
  destroy(): void;
}

/**
 * Article IDs in display order from the most recently mounted article list.
 * Kept across the articles → article-detail navigation so the detail view's
 * swipe navigation knows the neighbor articles.
 */
let lastArticleIds: string[] = [];

export class RouteView {
  private container: HTMLElement;
  private route: Route;
  private mounted: Mountable | null = null;
  private generation = 0;

  // No `layout` parameter: the only route whose rendering differed by layout was
  // `articles`, and desktop never reaches this class for it (see the comment in
  // the `articles` case). Every remaining route renders identically on both.
  constructor(container: HTMLElement, route: Route) {
    this.container = container;
    this.route = route;
    void this.mount();
  }

  update(route: Route): void {
    this.route = route;
    void this.mount();
  }

  destroy(): void {
    this.generation++;
    this.teardown();
  }

  private teardown(): void {
    if (this.mounted) {
      this.mounted.destroy();
      this.mounted = null;
    }
    this.container.innerHTML = '';
  }

  private async mount(): Promise<void> {
    const gen = ++this.generation;
    this.teardown();

    const view = document.createElement('div');
    view.className = 'route-view';
    this.container.appendChild(view);

    switch (this.route.path) {
      case 'home': {
        // Centered single-card layout (loading orb / digest body).
        view.classList.add('route-view--digest');
        const card = new DailyDigestCard(view);
        await card.init();
        if (gen !== this.generation) {
          card.destroy();
          return;
        }
        this.mounted = card;
        break;
      }

      case 'subscriptions': {
        const list = new SubscriptionList();
        view.appendChild(list.getElement());
        this.mounted = list;
        break;
      }

      case 'articles': {
        // Only the mobile layout reaches here. `DesktopLayout` forks on
        // `isMainRoute()`, and `'articles'` is a main route, so desktop mounts
        // `MainView` (the three-pane shell with FeedTree + ArticlePane) and
        // never constructs this view. Hence the compact Folo-style card list
        // is the only list this case needs — see test/desktop-routing.test.ts,
        // which pins that invariant.
        const list = new MobileArticleList({
          container: view,
          feedId: this.route.query.subscription ?? null,
          categoryId: this.route.query.category ?? null,
          onSelect: (id) => navigate(`/articles/${id}`),
        });
        await list.init();
        if (gen !== this.generation) {
          list.destroy();
          return;
        }
        this.mounted = list;
        lastArticleIds = list.getArticleIds();
        break;
      }

      case 'article-detail': {
        const articleId = this.route.params.id || getCurrentArticleId();
        if (!articleId) {
          view.innerHTML = `<div class="view-placeholder">${t('no_articles')}</div>`;
          return;
        }
        const detail = new ArticleView({
          container: view,
          articleId,
          getArticleIds: () => lastArticleIds,
        });
        await detail.init();
        if (gen !== this.generation) {
          detail.destroy();
          return;
        }
        this.mounted = detail;
        break;
      }

      case 'digest': {
        view.classList.add('route-view--digest');
        const card = new DailyDigestCard(view);
        await card.init();
        if (gen !== this.generation) {
          card.destroy();
          return;
        }
        this.mounted = card;
        break;
      }

      case 'bookmarks': {
        const bookmarks = new BookmarksView({ container: view });
        await bookmarks.init();
        if (gen !== this.generation) {
          bookmarks.destroy();
          return;
        }
        this.mounted = bookmarks;
        break;
      }

      case 'settings': {
        this.mounted = this.mountSettings(view);
        break;
      }

      default:
        view.innerHTML = `<div class="view-placeholder">${t('not_found')}</div>`;
    }
  }

  /**
   * Compose the settings view from the individual settings panels.
   */
  private mountSettings(view: HTMLElement): Mountable {
    const sections: Array<{
      icon: string;
      titleKey: string;
      descKey: string;
      component: { getElement(): HTMLElement; destroy(): void };
    }> = [
      { icon: '🎨', titleKey: 'theme', descKey: 'settings_theme_desc', component: new ThemeToggle() },
      { icon: '🌐', titleKey: 'language', descKey: 'settings_language_desc', component: new LanguageSwitch() },
      { icon: '🤖', titleKey: 'llm_config', descKey: 'settings_llm_desc', component: new LLMConfigPanel() },
      { icon: '🔊', titleKey: 'tts_config', descKey: 'settings_tts_desc', component: new TTSConfigPanel() },
      { icon: '🐙', titleKey: 'github_config', descKey: 'settings_github_desc', component: new GitHubConfigPanel() },
      { icon: '🔒', titleKey: 'password', descKey: 'settings_password_desc', component: new PasswordPanel() },
    ];

    const wrap = document.createElement('div');
    wrap.className = 'settings-view';

    // Page header
    const pageHeader = document.createElement('div');
    pageHeader.className = 'settings-page-header';
    const pageTitle = document.createElement('h2');
    pageTitle.className = 'settings-page-title';
    pageTitle.textContent = t('settings');
    pageHeader.appendChild(pageTitle);
    wrap.appendChild(pageHeader);

    for (const section of sections) {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'settings-section';

      const heading = document.createElement('div');
      heading.className = 'settings-heading';
      heading.innerHTML = `
        <span class="settings-heading__icon" aria-hidden="true">${section.icon}</span>
        <div class="settings-heading__text">
          <span class="settings-heading__title">${t(section.titleKey)}</span>
          <span class="settings-heading__desc">${t(section.descKey)}</span>
        </div>`;

      sectionEl.appendChild(heading);
      sectionEl.appendChild(section.component.getElement());
      wrap.appendChild(sectionEl);
    }

    view.appendChild(wrap);

    return {
      destroy: () => {
        for (const section of sections) {
          section.component.destroy();
        }
      },
    };
  }
}

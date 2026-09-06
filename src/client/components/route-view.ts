/**
 * RouteView — mounts the real feature component for the active route into a
 * container element and tears down the previous one on navigation.
 * Shared by DesktopLayout and MobileLayout so both layouts render the same
 * views with the same lifecycle handling.
 */

import { Route } from '../router.js';
import { getCurrentArticleId } from '../state.js';
import { t } from '../services/i18n.js';
import { DailyDigestCard } from './digest/DailyDigestCard.js';
import { SubscriptionList } from './subscription/SubscriptionList.js';
import { ArticleList } from './article/ArticleList.js';
import { ArticleView } from './article/ArticleView.js';
import { ThemeToggle } from './settings/ThemeToggle.js';
import { LanguageSwitch } from './settings/LanguageSwitch.js';
import { LLMConfigPanel } from './settings/LLMConfigPanel.js';
import { GitHubConfigPanel } from './settings/GitHubConfigPanel.js';

interface Mountable {
  destroy(): void;
}

/**
 * Article IDs in display order from the most recently mounted ArticleList.
 * Kept across the articles → article-detail navigation so the detail view's
 * swipe navigation knows the neighbor articles.
 */
let lastArticleIds: string[] = [];

export class RouteView {
  private container: HTMLElement;
  private route: Route;
  private mounted: Mountable | null = null;
  private generation = 0;

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
        const list = new ArticleList({ container: view });
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
        const card = new DailyDigestCard(view);
        await card.init();
        if (gen !== this.generation) {
          card.destroy();
          return;
        }
        this.mounted = card;
        break;
      }

      case 'settings': {
        this.mounted = this.mountSettings(view);
        break;
      }

      default:
        view.innerHTML = '<div class="view-placeholder">Not Found</div>';
    }
  }

  /**
   * Compose the settings view from the individual settings panels.
   */
  private mountSettings(view: HTMLElement): Mountable {
    const sections: Array<{
      titleKey: string;
      component: { getElement(): HTMLElement; destroy(): void };
    }> = [
      { titleKey: 'theme', component: new ThemeToggle() },
      { titleKey: 'language', component: new LanguageSwitch() },
      { titleKey: 'llm_config', component: new LLMConfigPanel() },
      { titleKey: 'github_config', component: new GitHubConfigPanel() },
    ];

    const wrap = document.createElement('div');
    wrap.className = 'settings-view';

    for (const section of sections) {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'settings-section';

      const heading = document.createElement('h2');
      heading.className = 'settings-heading';
      heading.textContent = t(section.titleKey);

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

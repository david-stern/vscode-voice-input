import { CONTROL_CENTER_ROUTES, type ControlCenterRoute } from './contracts';
import { element, labelledButton } from './dom';
import type { ControlCenterStrings } from './i18n';

export interface ControlCenterShell {
  app: HTMLElement;
  menu: HTMLButtonElement;
  brand: HTMLElement;
  auto: HTMLButtonElement;
  providerStatus: HTMLElement;
  navigation: HTMLElement;
  main: HTMLElement;
  heading: HTMLHeadingElement;
  purpose: HTMLElement;
  content: HTMLElement;
  overlayRoot: HTMLElement;
  progress: HTMLElement;
  success: HTMLElement;
  error: HTMLElement;
}

export function createControlCenterShell(root: HTMLElement, strings: ControlCenterStrings): ControlCenterShell {
  const app = element('div', { className: 'control-center', id: 'control-center-app' });
  const skip = element('a', { className: 'skip-link', text: strings.skip });
  skip.href = '#control-center-main';

  const header = element('header', { className: 'app-header' });
  const menu = labelledButton(strings.menu, 'open-navigation', 'button secondary menu-button');
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-controls', 'control-center-overlay');
  const brand = element('span', { className: 'brand', text: strings.product });
  const providerStatus = element('span', { className: 'provider-status', text: strings.notConfigured });
  const auto = labelledButton(strings.autoActive, 'disable-auto', 'button auto-badge');
  auto.id = 'auto-badge';
  auto.hidden = true;
  header.append(menu, brand, providerStatus, auto);

  const body = element('div', { className: 'app-body' });
  const navigation = element('nav', { className: 'primary-navigation', id: 'primary-navigation' });
  navigation.setAttribute('aria-label', strings.product);
  for (const route of CONTROL_CENTER_ROUTES) {
    const button = labelledButton(strings.routes[route].title, 'navigate', 'nav-item');
    button.dataset.route = route;
    navigation.append(button);
  }

  const main = element('main', { className: 'main-content', id: 'control-center-main' });
  const heading = element('h1', { id: 'route-title-home' });
  heading.tabIndex = -1;
  const purpose = element('p', { className: 'route-purpose' });
  const content = element('div', { className: 'route-content', id: 'route-content' });
  main.append(heading, purpose, content);
  body.append(navigation, main);

  const footer = element('footer', { className: 'status-regions' });
  footer.setAttribute('aria-label', strings.status);
  const progress = element('div', { id: 'progress-status', className: 'status-region' });
  progress.setAttribute('role', 'status');
  progress.setAttribute('aria-live', 'polite');
  const success = element('div', { id: 'success-status', className: 'status-region' });
  success.setAttribute('role', 'status');
  success.setAttribute('aria-live', 'polite');
  const error = element('div', { id: 'error-status', className: 'status-region error' });
  error.setAttribute('aria-live', 'assertive');
  footer.append(progress, success, error);

  app.append(skip, header, body, footer);
  const overlayRoot = element('div', { id: 'control-center-overlay' });
  root.replaceChildren(app, overlayRoot);
  return { app, menu, brand, auto, providerStatus, navigation, main, heading, purpose, content, overlayRoot, progress, success, error };
}

export function updateShellRoute(
  shell: ControlCenterShell,
  route: ControlCenterRoute,
  strings: ControlCenterStrings,
): void {
  shell.heading.id = `route-title-${route}`;
  shell.heading.textContent = strings.routes[route].title;
  shell.purpose.textContent = strings.routes[route].purpose;
  for (const button of Array.from(shell.navigation.querySelectorAll<HTMLButtonElement>('[data-route]'))) {
    const buttonRoute = button.dataset.route as ControlCenterRoute;
    button.textContent = strings.routes[buttonRoute].title;
    if (button.dataset.route === route) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

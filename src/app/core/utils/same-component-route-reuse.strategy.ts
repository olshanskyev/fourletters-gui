import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/**
 * Reuses the component instance when navigating between sibling routes that
 * render the same component (e.g. `/m` and `/m/:id`). This keeps the DOM
 * persistent across such navigations so CSS transitions can run.
 */
export class SameComponentRouteReuseStrategy implements RouteReuseStrategy {
  shouldDetach(): boolean {
    return false;
  }

  store(): void {
    // no-op: we do not detach routes
  }

  shouldAttach(): boolean {
    return false;
  }

  retrieve(): DetachedRouteHandle | null {
    return null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.routeConfig === curr.routeConfig) {
      return true;
    }

    return !!future.component && future.component === curr.component;
  }
}

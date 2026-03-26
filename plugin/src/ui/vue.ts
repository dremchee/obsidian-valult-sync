import { createApp, type App, type Component } from "vue";

export type MountedVueComponent = App<Element>;

export function mountComponent<Props extends Record<string, unknown>>(
  component: Component,
  target: HTMLElement,
  props: Props,
): MountedVueComponent {
  const app = createApp(component, props);
  app.mount(target);
  return app;
}

export async function destroyComponent(instance: MountedVueComponent | null): Promise<void> {
  if (!instance) {
    return;
  }

  instance.unmount();
}

import { mount, unmount } from "svelte";
import type { Component } from "svelte";

export type MountedSvelteComponent = ReturnType<typeof mount>;

export function mountComponent<Props extends Record<string, unknown>>(
  component: Component<Props>,
  target: HTMLElement,
  props: Props,
): MountedSvelteComponent {
  return mount(component, {
    target,
    props,
  });
}

export async function destroyComponent(instance: MountedSvelteComponent | null): Promise<void> {
  if (!instance) {
    return;
  }

  await unmount(instance);
}

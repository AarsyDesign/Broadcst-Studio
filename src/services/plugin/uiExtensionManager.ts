import { UIExtensionDescriptor, UIExtensionSlot } from './types';
import { logger } from '../logger';

/**
 * Host UI Extension Manager
 *
 * Manages controlled UI extension registrations contributed by plugins.
 * Guarantees that:
 * 1. UI contributions are associated with their specific owning plugin.
 * 2. When a plugin is disabled or uninstalled, its UI is unmounted and purged immediately.
 * 3. Plugins do not receive raw DOM access; UI components are rendered safely
 *    in approved workstation slots with design system tokens and error boundaries.
 */
class UIExtensionManager {
  private extensions: Map<string, UIExtensionDescriptor[]> = new Map();
  private subscribers: Set<(extensions: UIExtensionDescriptor[]) => void> = new Set();

  /**
   * Registers a UI extension descriptor for an enabled plugin.
   */
  public registerDescriptor(descriptor: UIExtensionDescriptor): () => void {
    const pluginId = descriptor.pluginId;
    if (!this.extensions.has(pluginId)) {
      this.extensions.set(pluginId, []);
    }

    const pluginList = this.extensions.get(pluginId)!;
    // Prevent duplicate IDs
    const existingIdx = pluginList.findIndex((d) => d.id === descriptor.id);
    if (existingIdx >= 0) {
      pluginList[existingIdx] = descriptor;
    } else {
      pluginList.push(descriptor);
    }

    logger.debug('UIExtensionManager', `Registered UI slot "${descriptor.slot}" from plugin "${pluginId}" (${descriptor.id})`);
    this.notify();

    return () => {
      this.unregisterDescriptor(pluginId, descriptor.id);
    };
  }

  /**
   * Unregisters a specific UI descriptor by ID.
   */
  public unregisterDescriptor(pluginId: string, descriptorId: string): void {
    const list = this.extensions.get(pluginId);
    if (!list) return;

    const filtered = list.filter((d) => d.id !== descriptorId);
    if (filtered.length === 0) {
      this.extensions.delete(pluginId);
    } else {
      this.extensions.set(pluginId, filtered);
    }

    this.notify();
  }

  /**
   * Cleans up all UI extensions owned by a plugin upon disable or uninstall.
   */
  public cleanupPluginExtensions(pluginId: string): void {
    if (this.extensions.has(pluginId)) {
      this.extensions.delete(pluginId);
      logger.info('UIExtensionManager', `Purged all UI extensions for plugin "${pluginId}"`);
      this.notify();
    }
  }

  /**
   * Retrieves all active UI descriptors assigned to a specific extension slot.
   */
  public getExtensionsForSlot(slot: UIExtensionSlot): UIExtensionDescriptor[] {
    const results: UIExtensionDescriptor[] = [];
    this.extensions.forEach((list) => {
      list.forEach((desc) => {
        if (desc.slot === slot) {
          results.push(desc);
        }
      });
    });
    return results;
  }

  /**
   * Retrieves all extensions registered by a specific plugin.
   */
  public getPluginExtensions(pluginId: string): UIExtensionDescriptor[] {
    return this.extensions.get(pluginId) || [];
  }

  /**
   * Retrieves all currently registered UI extensions.
   */
  public getAllExtensions(): UIExtensionDescriptor[] {
    const results: UIExtensionDescriptor[] = [];
    this.extensions.forEach((list) => {
      results.push(...list);
    });
    return results;
  }

  /**
   * Subscribes to UI extension updates.
   */
  public subscribe(listener: (extensions: UIExtensionDescriptor[]) => void): () => void {
    this.subscribers.add(listener);
    listener(this.getAllExtensions());
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private notify() {
    const all = this.getAllExtensions();
    this.subscribers.forEach((fn) => {
      try {
        fn(all);
      } catch (err) {
        logger.error('UIExtensionManager', 'Subscriber error', { error: err });
      }
    });
  }
}

export const uiExtensionManager = new UIExtensionManager();

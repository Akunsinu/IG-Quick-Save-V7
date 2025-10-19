// IMPROVED searchFiberForRelayEnvironment function
// This version searches more comprehensively and includes optional debug logging

function searchFiberForRelayEnvironment(fiber, depth = 0, visited = new Set(), debug = false) {
  if (!fiber || depth > 100) return null; // Increased depth limit
  if (visited.has(fiber)) return null;
  visited.add(fiber);

  try {
    // Helper function to check if something looks like a Relay environment
    function isRelayEnvironment(obj) {
      if (!obj || typeof obj !== 'object') return false;

      // Check for common Relay environment signatures
      return (
        (obj._store && typeof obj._store === 'object') ||
        (obj.getStore && typeof obj.getStore === 'function') ||
        (obj.__internal && obj.__internal.recordSource) ||
        (obj.configName && obj._network) || // Relay Modern
        (obj._recordSource && obj._network) // Alternative structure
      );
    }

    // Helper to log findings in debug mode
    function debugLog(message, data) {
      if (debug) {
        console.log(`[Fiber Search Depth ${depth}]`, message, data);
      }
    }

    // 1. Check memoizedState (hooks state for function components)
    if (fiber.memoizedState) {
      const state = fiber.memoizedState;

      // Direct check
      if (isRelayEnvironment(state.environment)) {
        debugLog('Found in memoizedState.environment', state.environment);
        return state.environment;
      }

      // Check all properties of memoizedState
      for (const key in state) {
        if (isRelayEnvironment(state[key])) {
          debugLog(`Found in memoizedState.${key}`, state[key]);
          return state[key];
        }
      }

      // Traverse state linked list (for hooks)
      let currentState = state;
      let stateDepth = 0;
      while (currentState && stateDepth < 50) {
        // Check memoizedState property
        if (currentState.memoizedState) {
          if (isRelayEnvironment(currentState.memoizedState)) {
            debugLog('Found in state.memoizedState (linked list)', currentState.memoizedState);
            return currentState.memoizedState;
          }

          // Check properties within memoizedState
          if (typeof currentState.memoizedState === 'object') {
            for (const key in currentState.memoizedState) {
              if (isRelayEnvironment(currentState.memoizedState[key])) {
                debugLog(`Found in state.memoizedState.${key} (linked list)`, currentState.memoizedState[key]);
                return currentState.memoizedState[key];
              }
            }
          }
        }

        // Check baseState property
        if (currentState.baseState && isRelayEnvironment(currentState.baseState.environment)) {
          debugLog('Found in state.baseState.environment (linked list)', currentState.baseState.environment);
          return currentState.baseState.environment;
        }

        // Check queue
        if (currentState.queue) {
          if (isRelayEnvironment(currentState.queue.lastRenderedState)) {
            debugLog('Found in state.queue.lastRenderedState', currentState.queue.lastRenderedState);
            return currentState.queue.lastRenderedState;
          }
        }

        currentState = currentState.next;
        stateDepth++;
      }
    }

    // 2. Check memoizedProps
    if (fiber.memoizedProps) {
      const props = fiber.memoizedProps;

      // Check environment property
      if (isRelayEnvironment(props.environment)) {
        debugLog('Found in memoizedProps.environment', props.environment);
        return props.environment;
      }

      // Check all props
      for (const key in props) {
        if (isRelayEnvironment(props[key])) {
          debugLog(`Found in memoizedProps.${key}`, props[key]);
          return props[key];
        }
      }
    }

    // 3. Check pendingProps
    if (fiber.pendingProps) {
      const props = fiber.pendingProps;

      if (isRelayEnvironment(props.environment)) {
        debugLog('Found in pendingProps.environment', props.environment);
        return props.environment;
      }

      for (const key in props) {
        if (isRelayEnvironment(props[key])) {
          debugLog(`Found in pendingProps.${key}`, props[key]);
          return props[key];
        }
      }
    }

    // 4. Check stateNode (for class components and DOM nodes)
    if (fiber.stateNode && typeof fiber.stateNode === 'object') {
      const instance = fiber.stateNode;

      // Skip DOM nodes
      if (!(instance instanceof Element)) {
        // Check props
        if (instance.props) {
          if (isRelayEnvironment(instance.props.environment)) {
            debugLog('Found in stateNode.props.environment', instance.props.environment);
            return instance.props.environment;
          }
          for (const key in instance.props) {
            if (isRelayEnvironment(instance.props[key])) {
              debugLog(`Found in stateNode.props.${key}`, instance.props[key]);
              return instance.props[key];
            }
          }
        }

        // Check state
        if (instance.state) {
          if (isRelayEnvironment(instance.state.environment)) {
            debugLog('Found in stateNode.state.environment', instance.state.environment);
            return instance.state.environment;
          }
          for (const key in instance.state) {
            if (isRelayEnvironment(instance.state[key])) {
              debugLog(`Found in stateNode.state.${key}`, instance.state[key]);
              return instance.state[key];
            }
          }
        }

        // Check context
        if (instance.context && isRelayEnvironment(instance.context)) {
          debugLog('Found in stateNode.context', instance.context);
          return instance.context;
        }

        // Check other properties
        for (const key in instance) {
          if (key !== 'props' && key !== 'state' && key !== 'refs') {
            if (isRelayEnvironment(instance[key])) {
              debugLog(`Found in stateNode.${key}`, instance[key]);
              return instance[key];
            }
          }
        }
      }
    }

    // 5. Check updateQueue
    if (fiber.updateQueue) {
      const queue = fiber.updateQueue;

      if (isRelayEnvironment(queue.baseState)) {
        debugLog('Found in updateQueue.baseState', queue.baseState);
        return queue.baseState;
      }

      if (isRelayEnvironment(queue.memoizedState)) {
        debugLog('Found in updateQueue.memoizedState', queue.memoizedState);
        return queue.memoizedState;
      }

      // Check shared
      if (queue.shared && isRelayEnvironment(queue.shared.pending)) {
        debugLog('Found in updateQueue.shared.pending', queue.shared.pending);
        return queue.shared.pending;
      }
    }

    // 6. Check dependencies
    if (fiber.dependencies) {
      const deps = fiber.dependencies;

      if (deps.firstContext) {
        let ctx = deps.firstContext;
        let ctxDepth = 0;
        while (ctx && ctxDepth < 20) {
          if (isRelayEnvironment(ctx.context)) {
            debugLog('Found in dependencies.firstContext.context', ctx.context);
            return ctx.context;
          }
          if (isRelayEnvironment(ctx.memoizedValue)) {
            debugLog('Found in dependencies.firstContext.memoizedValue', ctx.memoizedValue);
            return ctx.memoizedValue;
          }
          ctx = ctx.next;
          ctxDepth++;
        }
      }
    }

    // 7. Check type (component type/function)
    if (fiber.type && typeof fiber.type === 'object') {
      // Check context on component type
      if (fiber.type._context && isRelayEnvironment(fiber.type._context._currentValue)) {
        debugLog('Found in type._context._currentValue', fiber.type._context._currentValue);
        return fiber.type._context._currentValue;
      }

      if (fiber.type._context && isRelayEnvironment(fiber.type._context._currentValue2)) {
        debugLog('Found in type._context._currentValue2', fiber.type._context._currentValue2);
        return fiber.type._context._currentValue2;
      }
    }

    // 8. Check alternate fiber (work-in-progress vs current)
    if (fiber.alternate && !visited.has(fiber.alternate)) {
      visited.add(fiber.alternate);
      const altEnv = searchFiberForRelayEnvironment(fiber.alternate, depth, visited, debug);
      if (altEnv) return altEnv;
    }

    // 9. Traverse tree - BREADTH-FIRST for better performance
    // Collect all immediate relations first
    const toSearch = [];

    if (fiber.child) toSearch.push({ fiber: fiber.child, relation: 'child' });
    if (fiber.sibling) toSearch.push({ fiber: fiber.sibling, relation: 'sibling' });
    if (fiber.return && depth < 20) toSearch.push({ fiber: fiber.return, relation: 'parent' });

    // Search collected fibers
    for (const { fiber: nextFiber, relation } of toSearch) {
      const result = searchFiberForRelayEnvironment(nextFiber, depth + 1, visited, debug);
      if (result) {
        debugLog(`Found via ${relation} traversal`, result);
        return result;
      }
    }

  } catch (e) {
    if (debug) {
      console.error('[Fiber Search] Error at depth', depth, e);
    }
  }

  return null;
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { searchFiberForRelayEnvironment };
}

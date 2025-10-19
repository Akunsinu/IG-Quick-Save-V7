// DIAGNOSTIC SCRIPT - Run this in browser console to find Relay environment
// Copy and paste this entire script into the browser console on an Instagram post page

(function() {
  console.log('=== Instagram Relay Environment Diagnostic ===');

  // Helper to check if something looks like a Relay environment
  function isRelayEnvironment(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (
      (obj._store && typeof obj._store === 'object') ||
      (obj.getStore && typeof obj.getStore === 'function') ||
      (obj.__internal && obj.__internal.recordSource) ||
      (obj.configName && obj._network) ||
      (obj._recordSource && obj._network)
    );
  }

  // Helper to safely get property names
  function safeGetProperties(obj) {
    if (!obj || typeof obj !== 'object') return [];
    try {
      return Object.getOwnPropertyNames(obj);
    } catch (e) {
      return [];
    }
  }

  // Find React Fiber root
  function findFiberRoot() {
    const roots = [
      document.querySelector('main'),
      document.querySelector('#react-root'),
      document.body
    ];

    for (const root of roots) {
      if (!root) continue;

      const fiberKey = Object.keys(root).find(key =>
        key.startsWith('__reactFiber') ||
        key.startsWith('__reactInternalInstance')
      );

      if (fiberKey) {
        console.log('✅ Found React Fiber key:', fiberKey, 'on element:', root.tagName);
        return { root, fiberKey, fiber: root[fiberKey] };
      }
    }

    console.error('❌ No React Fiber found');
    return null;
  }

  // Analyze a single fiber node
  function analyzeFiber(fiber, depth = 0, maxSamples = 5) {
    if (!fiber) return;

    const indent = '  '.repeat(depth);
    const analysis = {
      depth,
      type: fiber.type?.name || fiber.type?.displayName || typeof fiber.type,
      elementType: fiber.elementType?.name,
      tag: fiber.tag,
      key: fiber.key
    };

    console.log(`${indent}Fiber [depth ${depth}]:`, analysis);

    // Check memoizedState
    if (fiber.memoizedState) {
      console.log(`${indent}  memoizedState properties:`, safeGetProperties(fiber.memoizedState).slice(0, 10));

      if (isRelayEnvironment(fiber.memoizedState)) {
        console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in memoizedState!`);
        return fiber.memoizedState;
      }

      // Check state properties
      for (const key of safeGetProperties(fiber.memoizedState).slice(0, maxSamples)) {
        const val = fiber.memoizedState[key];
        if (isRelayEnvironment(val)) {
          console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in memoizedState.${key}!`);
          return val;
        }
      }

      // Traverse state linked list
      let state = fiber.memoizedState;
      let stateIdx = 0;
      while (state && stateIdx < 10) {
        if (state.memoizedState && typeof state.memoizedState === 'object') {
          const stateProps = safeGetProperties(state.memoizedState);
          if (stateProps.length > 0 && stateIdx < 3) {
            console.log(`${indent}  state[${stateIdx}].memoizedState properties:`, stateProps.slice(0, 5));
          }

          if (isRelayEnvironment(state.memoizedState)) {
            console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in state[${stateIdx}].memoizedState!`);
            return state.memoizedState;
          }

          for (const key of stateProps.slice(0, maxSamples)) {
            if (isRelayEnvironment(state.memoizedState[key])) {
              console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in state[${stateIdx}].memoizedState.${key}!`);
              return state.memoizedState[key];
            }
          }
        }
        state = state.next;
        stateIdx++;
      }
    }

    // Check memoizedProps
    if (fiber.memoizedProps) {
      const propKeys = safeGetProperties(fiber.memoizedProps);
      if (propKeys.length > 0 && depth < 5) {
        console.log(`${indent}  memoizedProps properties:`, propKeys.slice(0, 10));
      }

      if (isRelayEnvironment(fiber.memoizedProps.environment)) {
        console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in memoizedProps.environment!`);
        return fiber.memoizedProps.environment;
      }

      for (const key of propKeys.slice(0, maxSamples)) {
        if (isRelayEnvironment(fiber.memoizedProps[key])) {
          console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in memoizedProps.${key}!`);
          return fiber.memoizedProps[key];
        }
      }
    }

    // Check stateNode
    if (fiber.stateNode && typeof fiber.stateNode === 'object' && !(fiber.stateNode instanceof Element)) {
      const nodeProps = safeGetProperties(fiber.stateNode);
      if (nodeProps.length > 0 && depth < 5) {
        console.log(`${indent}  stateNode properties:`, nodeProps.slice(0, 10));
      }

      if (fiber.stateNode.props) {
        for (const key of safeGetProperties(fiber.stateNode.props).slice(0, maxSamples)) {
          if (isRelayEnvironment(fiber.stateNode.props[key])) {
            console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in stateNode.props.${key}!`);
            return fiber.stateNode.props[key];
          }
        }
      }

      if (fiber.stateNode.state) {
        for (const key of safeGetProperties(fiber.stateNode.state).slice(0, maxSamples)) {
          if (isRelayEnvironment(fiber.stateNode.state[key])) {
            console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in stateNode.state.${key}!`);
            return fiber.stateNode.state[key];
          }
        }
      }
    }

    // Check dependencies
    if (fiber.dependencies && fiber.dependencies.firstContext) {
      console.log(`${indent}  Has dependencies.firstContext`);
      let ctx = fiber.dependencies.firstContext;
      let ctxIdx = 0;
      while (ctx && ctxIdx < 5) {
        if (isRelayEnvironment(ctx.memoizedValue)) {
          console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in dependencies.firstContext[${ctxIdx}].memoizedValue!`);
          return ctx.memoizedValue;
        }
        ctx = ctx.next;
        ctxIdx++;
      }
    }

    // Check type._context
    if (fiber.type && typeof fiber.type === 'object') {
      if (fiber.type._context) {
        if (isRelayEnvironment(fiber.type._context._currentValue)) {
          console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in type._context._currentValue!`);
          return fiber.type._context._currentValue;
        }
        if (isRelayEnvironment(fiber.type._context._currentValue2)) {
          console.log(`${indent}  🎯 FOUND RELAY ENVIRONMENT in type._context._currentValue2!`);
          return fiber.type._context._currentValue2;
        }
      }
    }

    return null;
  }

  // Breadth-first search with detailed logging
  function searchFiberTree(startFiber, maxDepth = 50) {
    const queue = [{ fiber: startFiber, depth: 0 }];
    const visited = new Set();
    let nodeCount = 0;

    console.log('\n=== Starting Breadth-First Fiber Tree Search ===');

    while (queue.length > 0 && nodeCount < 1000) {
      const { fiber, depth } = queue.shift();

      if (!fiber || visited.has(fiber) || depth > maxDepth) continue;
      visited.add(fiber);
      nodeCount++;

      // Analyze this fiber
      const env = analyzeFiber(fiber, depth, depth < 10 ? 5 : 2);
      if (env) {
        console.log('\n🎉 SUCCESS! Found Relay Environment!');
        console.log('Environment object:', env);
        console.log('Store:', env._store || env.getStore?.());

        // Try to get records
        const store = env._store || env.getStore?.();
        if (store) {
          console.log('Store properties:', Object.keys(store));

          const records = store._recordSource?._records ||
                         store._recordSource?.__records ||
                         store.getSource?.()._records ||
                         store.getSource?.().__records;

          if (records) {
            console.log('Record count:', Object.keys(records).length);
            console.log('Sample record keys:', Object.keys(records).slice(0, 10));
          }
        }

        return env;
      }

      // Add children to queue
      if (fiber.child) queue.push({ fiber: fiber.child, depth: depth + 1 });
      if (fiber.sibling) queue.push({ fiber: fiber.sibling, depth: depth + 1 });
      if (depth < 20 && fiber.return) queue.push({ fiber: fiber.return, depth: depth + 1 });
      if (fiber.alternate && !visited.has(fiber.alternate)) {
        queue.push({ fiber: fiber.alternate, depth: depth });
      }
    }

    console.log(`\n⚠️ Searched ${nodeCount} fiber nodes, no Relay environment found`);
    return null;
  }

  // Alternative: Check window globals
  function checkWindowGlobals() {
    console.log('\n=== Checking Window Globals ===');

    // Check for Relay-related globals
    const relayKeys = Object.keys(window).filter(key =>
      key.toLowerCase().includes('relay') ||
      key.toLowerCase().includes('graphql') ||
      key.toLowerCase().includes('store')
    );

    console.log('Relay-related window keys:', relayKeys);

    // Check specific known locations
    const checks = [
      'window.__relay',
      'window.__RelayModernEnvironment',
      'window._relay',
      'window.relayEnvironment',
      'window.__additionalDataLoaded__',
      'window._sharedData'
    ];

    for (const check of checks) {
      try {
        const val = eval(check);
        if (val) {
          console.log(`✅ ${check}:`, typeof val, val);
        }
      } catch (e) {
        // Silent
      }
    }
  }

  // Alternative: Check React DevTools hook
  function checkReactDevTools() {
    console.log('\n=== Checking React DevTools Hook ===');

    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      console.log('DevTools hook found:', Object.keys(hook));

      if (hook.renderers) {
        console.log('Renderers:', hook.renderers);
        hook.renderers.forEach((renderer, id) => {
          console.log(`Renderer ${id}:`, Object.keys(renderer));

          // Try to get fiber from renderer
          if (renderer.findFiberByHostInstance) {
            const mainEl = document.querySelector('main');
            if (mainEl) {
              try {
                const fiber = renderer.findFiberByHostInstance(mainEl);
                if (fiber) {
                  console.log('Got fiber from renderer!');
                  return searchFiberTree(fiber);
                }
              } catch (e) {
                console.log('Error getting fiber from renderer:', e.message);
              }
            }
          }
        });
      }
    } else {
      console.log('❌ React DevTools hook not found');
    }
  }

  // Main execution
  console.log('Starting diagnostic...\n');

  // Step 1: Find fiber root
  const fiberInfo = findFiberRoot();

  if (fiberInfo) {
    // Step 2: Search fiber tree
    const env = searchFiberTree(fiberInfo.fiber);

    if (env) {
      window.__foundRelayEnvironment = env;
      console.log('\n✅ Environment saved to window.__foundRelayEnvironment');
    }
  }

  // Step 3: Check alternatives
  checkWindowGlobals();
  checkReactDevTools();

  console.log('\n=== Diagnostic Complete ===');
  console.log('If environment was found, it is in window.__foundRelayEnvironment');
})();

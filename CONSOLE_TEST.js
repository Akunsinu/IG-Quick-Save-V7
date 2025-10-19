// CONSOLE TEST - Paste this directly into Instagram's console to find the Relay environment
// This bypasses the extension and tests directly

(function() {
  console.log('🔍 Starting Relay Environment Hunt...');

  // Strategy 1: Check React DevTools hook
  console.log('\n=== Strategy 1: React DevTools Hook ===');
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    console.log('✅ DevTools hook exists');

    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    console.log('Hook keys:', Object.keys(hook));

    // Try to get fiber roots
    if (hook.getFiberRoots) {
      const roots = hook.getFiberRoots(1); // React version 1
      console.log('Fiber roots:', roots);

      roots.forEach((root, i) => {
        console.log(`Root ${i}:`, root);

        // Check current fiber
        if (root.current) {
          const fiber = root.current;
          console.log(`  Current fiber:`, fiber);

          // Check memoizedState
          if (fiber.memoizedState) {
            console.log(`  Memoized state:`, fiber.memoizedState);

            // Look for environment
            let current = fiber.memoizedState;
            let depth = 0;
            while (current && depth < 20) {
              if (current.memoizedState?.environment) {
                console.log(`  🎯 FOUND environment in memoizedState chain at depth ${depth}!`);
                console.log(`  Environment:`, current.memoizedState.environment);
                window.__foundRelayEnv = current.memoizedState.environment;

                if (current.memoizedState.environment._store) {
                  console.log(`  ✅ HAS _store!`);
                  window.__foundRelayStore = current.memoizedState.environment._store;
                }
              }
              current = current.next;
              depth++;
            }
          }
        }
      });
    }
  } else {
    console.log('❌ No DevTools hook');
  }

  // Strategy 2: Use relay-runtime to create a store searcher
  console.log('\n=== Strategy 2: Search using relay-runtime classes ===');
  try {
    const RelayRuntime = window.require('relay-runtime');
    console.log('Got relay-runtime:', RelayRuntime);

    // The Store and Environment are constructors
    // Let's search for instances of these in the global scope
    console.log('Store constructor:', RelayRuntime.Store);
    console.log('Environment constructor:', RelayRuntime.Environment);

  } catch (e) {
    console.log('Error loading relay-runtime:', e);
  }

  // Strategy 3: Search React Fiber tree manually
  console.log('\n=== Strategy 3: Manual Fiber Tree Search ===');
  const mainElement = document.querySelector('main');
  if (mainElement) {
    const fiberKey = Object.keys(mainElement).find(k => k.startsWith('__reactFiber'));
    if (fiberKey) {
      console.log('✅ Found fiber key:', fiberKey);
      const fiber = mainElement[fiberKey];

      // Deep search function
      function searchForRelay(node, path = '', depth = 0, visited = new Set()) {
        if (!node || depth > 100 || visited.has(node)) return null;
        visited.add(node);

        try {
          // Check if this node has environment
          if (node.environment && node.environment._store) {
            console.log(`🎯 FOUND at ${path}!`);
            console.log('Environment:', node.environment);
            console.log('Store:', node.environment._store);
            window.__foundRelayEnv = node.environment;
            window.__foundRelayStore = node.environment._store;
            return node.environment;
          }

          // Check memoizedState chain
          if (node.memoizedState) {
            let state = node.memoizedState;
            let stateDepth = 0;
            while (state && stateDepth < 50) {
              if (state.environment && state.environment._store) {
                console.log(`🎯 FOUND in memoizedState chain at ${path}.memoizedState[${stateDepth}]!`);
                console.log('Environment:', state.environment);
                window.__foundRelayEnv = state.environment;
                window.__foundRelayStore = state.environment._store;
                return state.environment;
              }
              state = state.next;
              stateDepth++;
            }
          }

          // Check dependencies (React Context)
          if (node.dependencies) {
            let dep = node.dependencies;
            while (dep) {
              if (dep.memoizedValue && dep.memoizedValue._store) {
                console.log(`🎯 FOUND in dependencies at ${path}.dependencies!`);
                window.__foundRelayEnv = dep.memoizedValue;
                window.__foundRelayStore = dep.memoizedValue._store;
                return dep.memoizedValue;
              }
              dep = dep.next;
            }
          }

          // Search child
          if (node.child && depth < 100) {
            const found = searchForRelay(node.child, path + '.child', depth + 1, visited);
            if (found) return found;
          }

          // Search sibling
          if (node.sibling && depth < 100) {
            const found = searchForRelay(node.sibling, path + '.sibling', depth + 1, visited);
            if (found) return found;
          }

        } catch (e) {
          // Skip errors
        }

        return null;
      }

      console.log('Starting deep fiber search...');
      const found = searchForRelay(fiber);

      if (found) {
        console.log('\n✅✅✅ SUCCESS! Found Relay Environment ✅✅✅');
      } else {
        console.log('\n❌ Not found in fiber tree');
      }
    }
  }

  // Strategy 4: Check XPlatRelayEnvironment module
  console.log('\n=== Strategy 4: Check XPlatRelayEnvironment ===');
  try {
    const XPlatRelay = window.require('XPlatRelayEnvironment');
    console.log('XPlatRelayEnvironment:', XPlatRelay);
    console.log('Keys:', Object.keys(XPlatRelay || {}));
  } catch (e) {
    console.log('Could not load XPlatRelayEnvironment:', e.message);
  }

  // Final check
  console.log('\n=== RESULTS ===');
  if (window.__foundRelayEnv) {
    console.log('✅ Relay Environment:', window.__foundRelayEnv);
    console.log('✅ Relay Store:', window.__foundRelayStore);

    // Try to get records
    if (window.__foundRelayStore) {
      try {
        const source = window.__foundRelayStore.getSource();
        const records = source.toJSON();
        console.log('✅ Records count:', Object.keys(records).length);
        console.log('Sample record IDs:', Object.keys(records).slice(0, 10));

        // Search for current post
        const shortcode = window.location.pathname.match(/\/p\/([^\/]+)/)?.[1];
        if (shortcode) {
          console.log('\nSearching for shortcode:', shortcode);
          for (const [id, record] of Object.entries(records)) {
            if (record && record.shortcode === shortcode) {
              console.log('🎯 FOUND POST!', record);
              break;
            }
          }
        }
      } catch (e) {
        console.log('Error getting records:', e);
      }
    }
  } else {
    console.log('❌ Could not find Relay Environment');
  }

})();

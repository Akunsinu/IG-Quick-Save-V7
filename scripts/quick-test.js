// QUICK TEST SCRIPT
// Run this in browser console to quickly test if Relay environment can be found
// This uses the improved search algorithm

(function() {
  console.log('=== Quick Relay Environment Test ===\n');

  // Helper function
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

  // Find React Fiber
  const roots = [
    document.querySelector('main'),
    document.querySelector('#react-root'),
    document.body
  ];

  let fiber = null;
  let fiberKey = null;

  for (const root of roots) {
    if (!root) continue;

    fiberKey = Object.keys(root).find(key =>
      key.startsWith('__reactFiber') ||
      key.startsWith('__reactInternalInstance')
    );

    if (fiberKey) {
      fiber = root[fiberKey];
      console.log('✅ Found React Fiber:', fiberKey);
      console.log('   Root element:', root.tagName);
      break;
    }
  }

  if (!fiber) {
    console.error('❌ No React Fiber found!');
    return;
  }

  // Quick breadth-first search (limited for speed)
  const queue = [fiber];
  const visited = new Set();
  let nodeCount = 0;
  let foundEnv = null;

  console.log('\n🔍 Searching for Relay environment...\n');

  while (queue.length > 0 && nodeCount < 500 && !foundEnv) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    nodeCount++;

    try {
      // Quick checks on current fiber
      const checks = [
        { obj: current.memoizedState?.environment, path: 'memoizedState.environment' },
        { obj: current.memoizedProps?.environment, path: 'memoizedProps.environment' },
      ];

      // Check state linked list
      let state = current.memoizedState;
      let stateIdx = 0;
      while (state && stateIdx < 10) {
        if (state.memoizedState) {
          checks.push({ obj: state.memoizedState, path: `state[${stateIdx}].memoizedState` });
        }
        state = state.next;
        stateIdx++;
      }

      // Check stateNode
      if (current.stateNode && !(current.stateNode instanceof Element)) {
        checks.push({ obj: current.stateNode.props?.environment, path: 'stateNode.props.environment' });
      }

      // Check dependencies
      if (current.dependencies?.firstContext) {
        let ctx = current.dependencies.firstContext;
        let ctxIdx = 0;
        while (ctx && ctxIdx < 5) {
          checks.push({ obj: ctx.memoizedValue, path: `dependencies.context[${ctxIdx}].memoizedValue` });
          ctx = ctx.next;
          ctxIdx++;
        }
      }

      // Evaluate checks
      for (const { obj, path } of checks) {
        if (isRelayEnvironment(obj)) {
          console.log(`\n🎉 FOUND! at ${path}`);
          console.log('   Node count searched:', nodeCount);
          foundEnv = obj;
          break;
        }
      }

      if (foundEnv) break;

      // Add to queue
      if (current.child) queue.push(current.child);
      if (current.sibling) queue.push(current.sibling);
      if (current.alternate && !visited.has(current.alternate)) {
        queue.push(current.alternate);
      }

    } catch (e) {
      // Continue
    }
  }

  if (foundEnv) {
    console.log('\n✅ Relay Environment Found!\n');
    console.log('Environment:', foundEnv);

    // Try to get store
    const store = foundEnv._store || foundEnv.getStore?.();
    if (store) {
      console.log('\n✅ Store Found!');
      console.log('Store keys:', Object.keys(store));

      // Try to get records
      const records = store._recordSource?._records ||
                     store._recordSource?.__records ||
                     store.getSource?.()._records ||
                     store.getSource?.().__records ||
                     store._records ||
                     store.__records;

      if (records) {
        const recordKeys = Object.keys(records);
        console.log('\n✅ Records Found!');
        console.log('   Total records:', recordKeys.length);
        console.log('   Sample keys:', recordKeys.slice(0, 5));

        // Look for post-like records
        const postRecords = recordKeys.filter(key => {
          const record = records[key];
          return record?.shortcode || record?.__typename?.includes('Graph');
        });

        console.log('   Post-like records:', postRecords.length);

        // Save to window for inspection
        window.__testRelayEnv = foundEnv;
        window.__testRelayStore = store;
        window.__testRelayRecords = records;

        console.log('\n💾 Saved to window:');
        console.log('   window.__testRelayEnv');
        console.log('   window.__testRelayStore');
        console.log('   window.__testRelayRecords');

      } else {
        console.warn('\n⚠️ Could not find records in store');
        console.log('Store structure:', store);
      }
    } else {
      console.warn('\n⚠️ Could not get store from environment');
    }

  } else {
    console.error(`\n❌ Relay environment not found after searching ${nodeCount} nodes`);
    console.log('\nTroubleshooting:');
    console.log('1. Wait 15-30 seconds after page load and try again');
    console.log('2. Navigate to a different Instagram post');
    console.log('3. Run the full diagnostic script: diagnostic-console-script.js');
    console.log('4. Check if Instagram updated their code structure');
  }

  console.log('\n=== Test Complete ===');
})();

////////////QUANTUM_SIZE = GUARD_STACK = 1;
// Generates code that can be placed inline in generated code.
// This is not the cleanest way to write this kind of code - it is
// optimized for generating fast inline code.
RuntimeGenerator = {
  alloc: function(size, type) {
    var ret = type + 'TOP';
//    ret += '; for (var i = 0; i < ' + size + '; i++) HEAP[' + type + 'TOP+i] = 0';
    if (GUARD_MEMORY) {
      ret += '; assert(' + size + ' > 0)';
    }
    ret += '; ' + type + 'TOP += ' + size;
    if (QUANTUM_SIZE > 1) {
      ret += ';' + RuntimeGenerator.alignMemory(type + 'TOP', QUANTUM_SIZE);
    }
    return ret;
  },

  // An allocation that lives as long as the current function call
  stackAlloc: function(size) {
    var ret = RuntimeGenerator.alloc(size, 'STACK');
    if (GUARD_MEMORY) {
      ret += '; assert(STACKTOP < STACK_ROOT + STACK_MAX)';
    }
    return ret;
  },

  stackEnter: function(initial) {
    if (initial === 0) return ''; // XXX Note that we don't even push the stack! This is faster, but
                                  // means that we don't clear stack allocations done in this function
                                  // until the parent unwinds its stack. So potentially if we are in
                                  // a loop, we can use a lot of memory.
    var ret = 'var __stackBase__  = STACKTOP; STACKTOP += ' + initial;
    if (GUARD_MEMORY) {
      ret += '; assert(STACKTOP < STACK_MAX)';
    }
    return ret;
  },

  stackExit: function(initial) {
    if (initial === 0) return ''; // XXX See comment in stackEnter
    return 'STACKTOP = __stackBase__';
  },

  // An allocation that cannot be free'd
  staticAlloc: function(size) {
    return RuntimeGenerator.alloc(size, 'STATIC');
  },

  alignMemory: function(target, quantum) {
    if (typeof quantum !== 'number') {
      quantum = '(quantum ? quantum : QUANTUM_SIZE)';
    }
    return target + ' = Math.ceil(' + target + '/' + quantum + ')*' + quantum + ';';
  },
};

function unInline(name_, params) {
  var src = '(function ' + name_ + '(' + params + ') { var ret = ' + RuntimeGenerator[name_].apply(null, params) + '; return ret; })';
  //print('src: ' + src);
  return eval(src);
}

// Uses the RuntimeGenerator during compilation, in order to
//  1. Let the compiler access and run those functions during compilation
//  2. We expose the entire Runtime object to generated code, so it can
//     use that functionality in a non-inline manner.
Runtime = {
  stackAlloc: unInline('stackAlloc', ['size']),
  staticAlloc: unInline('staticAlloc', ['size']),
  alignMemory: unInline('alignMemory', ['size', 'quantum']),

  FUNCTION_TABLE: [],
  getFunctionIndex: function getFunctionIndex(func) {
    var key = Runtime.FUNCTION_TABLE.length;
    FUNCTION_TABLE[key] = func;
    return key;
  },

  // TODO: cleanup
  isNumberType: isNumberType,
  INT_TYPES: INT_TYPES,
  getNativeFieldSize: getNativeFieldSize,
  dedup: dedup,

  // Calculate aligned size, just like C structs should be. TODO: Consider
  // requesting that compilation be done with #pragma pack(push) /n #pragma pack(1),
  // which would remove much of the complexity here.
  calculateStructAlignment: function calculateStructAlignment(type, otherTypes) {
    type.flatSize = 0;
    var diffs = [];
    var prev = -1, maxSize = -1;
    type.flatIndexes = type.fields.map(function(field) {
      var size;
      if (isNumberType(field) || isPointerType(field)) {
        size = getNativeFieldSize(field, true); // pack char; char; in structs, also char[X]s.
        maxSize = Math.max(maxSize, size);
      } else if (isStructType(field)) {
        size = otherTypes[field].flatSize;
        maxSize = Math.max(maxSize, QUANTUM_SIZE);
      } else {
        dprint('Unclear type in struct: ' + field + ', in ' + type.name_);
        assert(0);
      }
      var curr = Runtime.alignMemory(type.flatSize, Math.min(QUANTUM_SIZE, size)); // if necessary, place this on aligned memory
      type.flatSize = curr + size;
      if (prev >= 0) {
        diffs.push(curr-prev);
      }
      prev = curr;
      return curr;
    });
    type.flatSize = Runtime.alignMemory(type.flatSize, maxSize);
    if (diffs.length == 0) {
      type.flatFactor = type.flatSize;
    } else if (dedup(diffs).length == 1) {
      type.flatFactor = diffs[0];
    }
    type.needsFlattening = (this.flatFactor != 1);
    return type.flatIndexes;
  }

};

function getRuntime() {
  var ret = '';
  for (i in Runtime) {
    var item = Runtime[i];
    if (typeof item === 'function') {
      ret += item.toString() + '\n';
    } else {
      ret += 'var ' + i + ' = ' + JSON.stringify(item) + ';\n';
    }
  }
  return ret + '\n';
}

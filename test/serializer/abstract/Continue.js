let x = global.__abstract ? __abstract("boolean", "true") : true;

let arr = [];

for (let i of [1, 2, 3]) {
  arr[i] = i * 10;
  if (x) continue; else continue;
}

z = arr;

inspect = function() { return "" + z; }

var x = 42.42;
y = global.__abstract ? __abstract("number", x.toString()) : x;
s = Math.round(y);
inspect = function() { return s; }

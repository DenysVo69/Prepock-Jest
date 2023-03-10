/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { PropertyKeyValue } from "../types.js";
import type { Realm } from "../realm.js";
import type { Descriptor } from "../types.js";
import { ToBooleanPartial, ToUint32, ToString } from "./to.js";
import { Get } from "./get.js";
import { FunctionValue, NullValue, ProxyValue, ArrayValue, StringValue,  SymbolValue, ObjectValue, NumberValue, AbstractValue, AbstractObjectValue } from "../values/index.js";
import { Value } from "../values/index.js";
import invariant from "../invariant.js";
import { HasName, HasCompatibleType } from "./has.js";
import type { BabelNodeExpression, BabelNodeCallExpression, BabelNodeLVal } from "babel-types";

// ECMA262 22.1.3.1.1
export function IsConcatSpreadable(realm: Realm, O: Value): boolean {
  // 1. If Type(O) is not Object, return false.
  if (!O.mightBeObject()) return false;
  O = O.throwIfNotObject();

  // 2. Let spreadable be ? Get(O, @@isConcatSpreadable).
  let spreadable = Get(realm, O, realm.intrinsics.SymbolIsConcatSpreadable);

  // 3. If spreadable is not undefined, return ToBoolean(spreadable).
  if (!spreadable.mightBeUndefined()) return ToBooleanPartial(realm, spreadable);
  spreadable.throwIfNotConcrete();

  // 4. Return ? IsArray(O).
  return IsArray(realm, O);
}

// ECMA262 6.2.4.3
export function IsGenericDescriptor(realm: Realm, Desc: ?Descriptor): boolean {
  // 1. If Desc is undefined, return false.
  if (!Desc) return false;

  // 2. If IsAccessorDescriptor(Desc) and IsDataDescriptor(Desc) are both false, return true.
  if (!IsAccessorDescriptor(realm, Desc) && !IsDataDescriptor(realm, Desc)) return true;

  // 3. Return false.
  return false;
}

// ECMA262 6.2.4.1
export function IsAccessorDescriptor(realm: Realm, Desc: ?Descriptor): boolean {
  // 1. If Desc is undefined, return false.
  if (!Desc) return false;

  // 2. If both Desc.[[Get]] and Desc.[[Set]] are absent, return false.
  if (!("get" in Desc) && !("set" in Desc)) return false;

  // 3. Return true.
  return true;
}

// ECMA262 6.2.4.2
export function IsDataDescriptor(realm: Realm, Desc: ?Descriptor): boolean {
  // If Desc is undefined, return false.
  if (!Desc) return false;

  // If both Desc.[[Value]] and Desc.[[Writable]] are absent, return false.
  if (!("value" in Desc) && !("writable" in Desc)) return false;

  // Return true.
  return true;
}

// ECMA262 9.1.3.1
export function OrdinaryIsExtensible(realm: Realm, O: ObjectValue): boolean {
  // 1. Return the value of the [[Extensible]] internal slot of O.
  return O.getExtensible();
}

// ECMA262 7.2.5
export function IsExtensible(realm: Realm, O: ObjectValue | AbstractObjectValue): boolean {
  // 1. Assert: Type(O) is Object.
  invariant(O instanceof ObjectValue || O instanceof AbstractObjectValue, "expected object value");

  // 2. Return ? O.[[IsExtensible]]().
  return O.$IsExtensible();
}

// ECMA262 7.2.3
export function IsCallable(realm: Realm, func: Value): boolean {
  // 1. If Type(argument) is not Object, return false.
  if (!func.mightBeObject()) return false;
  if (HasCompatibleType(realm, func, FunctionValue)) return true;

  // 2. If argument has a [[Call]] internal method, return true.
  func = func.throwIfNotConcreteObject();
  if (func.$Call) return true;

  // 3. Return false.
  return false;
}

// ECMA262 7.2.4
export function IsConstructor(realm: Realm, argument: Value): boolean {
  // 1. If Type(argument) is not Object, return false.
  if (!argument.mightBeObject()) return false;

  // 2. If argument has a [[Construct]] internal method, return true.
  argument = argument.throwIfNotConcreteObject();
  if (argument.$Construct) return true;

  // 3. Return false.
  return false;
}

// ECMA262 7.2.6
export function IsInteger(realm: Realm, argument: number): boolean {
  // 1. If Type(argument) is not Number, return false.
  invariant(typeof argument === "number", "Type(argument) is not number");

  // 2. If argument is NaN, +???, or -???, return false.
  if (isNaN(argument) || argument === +Infinity || argument === -Infinity) return false;

  // 3. If floor(abs(argument)) ??? abs(argument), return false.
  if (Math.floor(Math.abs(argument)) !== Math.abs(argument)) return false;

  // 4. Return true.
  return true;
}

// ECMA262 7.2.7
export function IsPropertyKey(realm: Realm, arg: string | Value): boolean {
  // We allow native strings to be passed around to avoid constructing a StringValue
  if (typeof arg === "string") return true;

  // 1. If Type(argument) is String, return true.
  if (arg instanceof StringValue) return true;

  // 2. If Type(argument) is Symbol, return true.
  if (arg instanceof SymbolValue) return true;

  if (arg instanceof AbstractValue) return AbstractValue.throwIntrospectionError(arg);

  // 3. Return false.
  return false;
}

// ECMA262 7.2.2
export function IsArray(realm: Realm, argument: Value): boolean {
  // 1. If Type(argument) is not Object, return false.
  if (!argument.mightBeObject()) return false;

  // 2. If argument is an Array exotic object, return true.
  if (argument instanceof ArrayValue || argument === realm.intrinsics.ArrayPrototype) return true;

  // 3. If argument is a Proxy exotic object, then
  if (argument instanceof ProxyValue) {
    // a. If the value of the [[ProxyHandler]] internal slot of argument is null, throw a TypeError exception.
    if (!argument.$ProxyHandler || argument.$ProxyHandler instanceof NullValue) {
      throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError);
    }

    // b. Let target be the value of the [[ProxyTarget]] internal slot of argument.
    let target = argument.$ProxyTarget;

    // c. Return ? IsArray(target).
    return IsArray(realm, target);
  }

  // 4. Return false.
  argument.throwIfNotConcrete();
  return false;
}

// ECMA262 14.6.1
export function IsInTailPosition(realm: Realm, node: BabelNodeCallExpression): boolean {
  // TODO: implement tail calls
  return false;
}

// ECMA262 7.2.8
export function IsRegExp(realm: Realm, argument: Value): boolean {
  // 1. If Type(argument) is not Object, return false.
  if (!argument.mightBeObject()) return false;
  argument = argument.throwIfNotObject();

  // 2. Let isRegExp be ? Get(argument, @@match).
  let isRegExp = Get(realm, argument, realm.intrinsics.SymbolMatch);

  // 3. If isRegExp is not undefined, return ToBoolean(isRegExp).
  if (isRegExp !== undefined) return ToBooleanPartial(realm, isRegExp) === true;

  // 4. If argument has a [[RegExpMatcher]] internal slot, return true.
  if (argument.$RegExpMatcher) return true;

  // 5. Return false.
  return false;
}

// ECMA262 12.2.1.4 Static Semantics: IsIdentifierRef
// ECMA262 12.3.1.4 Static Semantics: IsIdentifierRef
export function IsIdentifierRef(realm: Realm, node: BabelNodeLVal): boolean {
  switch (node.type){
    // ECMA262 12.2.1.4 Static Semantics: IsIdentifierRef
    case "Identifier":
      return true;
    // ECMA262 12.3.1.4 Static Semantics: IsIdentifierRef
    case "CallExpression":
    case "MemberExpression":
    case "NewExpression":
      return false;
    default:
     throw Error("Unexpected AST form : " + node.type);
  }
}

// 12.2.1.3 Static Semantics: IsFunctionDefinition
// 12.2.1.3 Static Semantics: IsFunctionDefinition
// 12.13 Binary Logical Operators
// 12.3.1.2 Static Semantics: IsFunctionDefinition
// 12.15.2 Static Semantics: IsFunctionDefinition
export function IsFunctionDefinition(realm: Realm, node: BabelNodeExpression): boolean {
  switch (node.type){
    // 12.2.1.3 Static Semantics: IsFunctionDefinition
    case "ThisExpression":
    case "Identifier":
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "RegExpLiteral":
    case "ArrayExpression":
    case "ObjectExpression":
    case "RegularExpressionLiteral":
    case "TemplateLiteral":
    case "ConditionalExpression":
      return false;
    // 12.2.1.3 Static Semantics: IsFunctionDefinition
    case "UpdateExpression":
      return false;
    // 12.13 Binary Logical Operators
    case "BinaryExpression":
    case "LogicalExpression":
      return false;
    // 12.3.1.2 Static Semantics: IsFunctionDefinition
    case "MemberExpression":
    case "CallExpression":
    case "NewExpression":
    case "MetaProperty":
    case "TaggedTemplateExpression":
      return false;
    //12.5.1 Static Semantics: IsFunctionDefinition
    case "UnaryExpression":
      return false;
    //12.15.2 Static Semantics: IsFunctionDefinition
    case "AssignmentExpression":
      return false;
    //12.16.1 Static Semantics: IsFunctionDefinition
    case "SequenceExpression":
      return false;
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return true;
    default:
      throw Error("Unexpected AST form : " + node.type);
  }
}

// ECMA262 14.1.10
export function IsAnonymousFunctionDefinition(realm: Realm, node: BabelNodeExpression): boolean {
  // 1. If IsFunctionDefinition of production is false, return false.
  if (!IsFunctionDefinition(realm, node))
    return false;

  // 2. Let hasName be the result of HasName of production.
  let hasName = HasName(realm, node);

  // 3. If hasName is true, return false.
  if (hasName === true) return false;

  // 4. Return true.
  return true;
}

// ECMA262 9.4.2
export function IsArrayIndex(realm: Realm, P: PropertyKeyValue): boolean {
  let key;
  if (typeof P === "string") {
    key = P;
  } else if (P instanceof StringValue) {
    key = P.value;
  } else {
    return false;
  }

  let i = ToUint32(realm, new StringValue(realm, key));
  return i !== Math.pow(2, 32) - 1 && ToString(realm, new NumberValue(realm, i)) === key;
}

// ECMA262 25.4.1.6
export function IsPromise(realm: Realm, x: Value): boolean {
  // 1. If Type(x) is not Object, return false.
  if (!x.mightBeObject()) return false;

  // 2. If x does not have a [[PromiseState]] internal slot, return false.
  x = x.throwIfNotConcreteObject();
  if (!x.$PromiseState) return false;

  // 3. Return true.
  return true;
}

// ECMA262 24.1.1.2
export function IsDetachedBuffer(realm: Realm, arrayBuffer: ObjectValue): boolean {
  // 1. Assert: Type(arrayBuffer) is Object and it has an [[ArrayBufferData]] internal slot.
  invariant(arrayBuffer instanceof ObjectValue && '$ArrayBufferData' in arrayBuffer);

  // 2. If arrayBuffer's [[ArrayBufferData]] internal slot is null, return true.
  if (arrayBuffer.$ArrayBufferData === null) return true;

  // 3. Return false.
  return false;
}

export function IsIntrospectionError(realm: Realm, value: Value): boolean {
  if (!value.mightBeObject()) return false;
  value = value.throwIfNotConcreteObject();
  return value.$GetPrototypeOf() === realm.intrinsics.__IntrospectionErrorPrototype;
}

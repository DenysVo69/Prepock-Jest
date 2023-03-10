/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { Realm } from "../realm.js";
import type { LexicalEnvironment } from "../environment.js";
import { DeclarativeEnvironmentRecord } from "../environment.js";
import { Reference } from "../environment.js";
import { BreakCompletion, AbruptCompletion, ContinueCompletion } from "../completions.js";
import { EmptyValue, ObjectValue, Value, NullValue, UndefinedValue } from "../values/index.js";
import invariant from "../invariant.js";
import {
  InitializeReferencedBinding,
  GetValue,
  PutValue,
  IteratorStep,
  IteratorValue,
  NewDeclarativeEnvironment,
  ResolveBinding,
  IteratorClose,
  ToObject,
  EnumerateObjectProperties,
  UpdateEmpty,
  BoundNames,
  BindingInitialization,
  GetIterator,
  IsDestructuring,
  HasSomeCompatibleType
} from "../methods/index.js";
import type { BabelNodeForOfStatement, BabelNodeVariableDeclaration, BabelNodeLVal, BabelNode, BabelNodeStatement } from "babel-types";

export type IterationKind = "iterate" | "enumerate";
export type LhsKind = "lexicalBinding" | "varBinding" | "assignment";

export function InternalGetResultValue(realm: Realm, result: Reference | Value | AbruptCompletion): Value {
  if (result instanceof AbruptCompletion) {
    return result.value || realm.intrinsics.empty;
  } else if (result instanceof Value) {
    return result;
  }
  invariant(false);
}

// ECMA262 13.7.1.2
export function LoopContinues(realm: Realm, completion: Reference | Value | AbruptCompletion, labelSet: ?Array<string>): boolean {
  // 1. If completion.[[Type]] is normal, return true.
  if (completion instanceof Value || completion instanceof Reference) return true;
  invariant(completion instanceof AbruptCompletion);

  // 2. If completion.[[Type]] is not continue, return false.
  if (!(completion instanceof ContinueCompletion)) return false;

  // 3. If completion.[[Target]] is empty, return true.
  if (!completion.target) return true;

  // 4. If completion.[[Target]] is an element of labelSet, return true.
  if (labelSet != null && labelSet.indexOf(completion.target) >= 0) return true;

  // 5. Return false.
  return false;
}

// ECMA262 13.7.5.10
function BindingInstantiation(realm: Realm, ast: BabelNodeVariableDeclaration, env: LexicalEnvironment) {
  // ast = ForDeclaration : LetOrConst ForBinding

  // 1. Let envRec be environment's EnvironmentRecord.
  let envRec = env.environmentRecord;

  // 2. Assert: envRec is a declarative Environment Record.
  invariant(envRec instanceof DeclarativeEnvironmentRecord);

  // 3. For each element name of the BoundNames of ForBinding do
  for (let decl of ast.declarations) {
    if (decl.id.type !== "Identifier")
      throw new Error("TODO: Patterns aren't supported yet");
    // a. If IsConstantDeclaration of LetOrConst is true, then
    if (ast.kind === "const") {
      // i. Perform ! envRec.CreateImmutableBinding(name, true).
      envRec.CreateImmutableBinding(decl.id.name, true);
    } else { // b.
      // i. Perform ! envRec.CreateMutableBinding(name, false).
      envRec.CreateMutableBinding(decl.id.name, false);
    }
  }
}

// ECMA262 13.7.5.12
export function ForInOfHeadEvaluation(realm: Realm, env: LexicalEnvironment, TDZnames: Array<string>, expr: BabelNode, iterationKind: IterationKind, strictCode: boolean) {
  // 1. Let oldEnv be the running execution context's LexicalEnvironment.
  let oldEnv = realm.getRunningContext().lexicalEnvironment;

  // 2. If TDZnames is not an empty List, then
  if (TDZnames.length) {
    // a. Assert: TDZnames has no duplicate entries.

    // b. Let TDZ be NewDeclarativeEnvironment(oldEnv).
    let TDZ = NewDeclarativeEnvironment(realm, oldEnv);

    // c. Let TDZEnvRec be TDZ's EnvironmentRecord.
    let TDZEnvRec = TDZ.environmentRecord;

    // d. For each string name in TDZnames, do
    for (let name of TDZnames) {
      if (typeof name === "string") {
        // i. Perform ! TDZEnvRec.CreateMutableBinding(name, false).
        TDZEnvRec.CreateMutableBinding(name, false);
      }
    }

    // e. Set the running execution context's LexicalEnvironment to TDZ.
    realm.getRunningContext().lexicalEnvironment = TDZ;
    env = TDZ;
  }

  let exprRef;
  try {
    // 3. Let exprRef be the result of evaluating expr.
    exprRef = env.evaluate(expr, strictCode);
  } finally {
    // 4. Set the running execution context's LexicalEnvironment to oldEnv.
    realm.getRunningContext().lexicalEnvironment = oldEnv;
  }
  env = oldEnv;

  // 5. Let exprValue be ? GetValue(exprRef).
  let exprValue = GetValue(realm, exprRef);

  // 6. If iterationKind is enumerate, then
  if (iterationKind === "enumerate") {
    // a. If exprValue.[[Value]] is null or undefined, then
    if (HasSomeCompatibleType(realm, exprValue, NullValue, UndefinedValue)) {
      // i. Return Completion{[[Type]]: break, [[Value]]: empty, [[Target]]: empty}.
      throw new BreakCompletion(realm.intrinsics.empty, undefined);
    }

    // b. Let obj be ToObject(exprValue).
    let obj = ToObject(realm, exprValue.throwIfNotConcrete());

    // c. Return ? EnumerateObjectProperties(obj).
    return EnumerateObjectProperties(realm, obj);
  } else { // 8. Else,
    // 1. Assert: iterationKind is iterate.
    invariant(iterationKind === "iterate", "expected iterationKind to be iterate");

    // 1. Return ? GetIterator(exprValue).
    return GetIterator(realm, exprValue);
  }
}

// ECMA262 13.7.5.13
export function ForInOfBodyEvaluation(realm: Realm, env: LexicalEnvironment, lhs: BabelNodeVariableDeclaration | BabelNodeLVal, stmt: BabelNodeStatement, iterator: ObjectValue, lhsKind: LhsKind, labelSet: ?Array<string>, strictCode: boolean) {
  // 1. Let oldEnv be the running execution context's LexicalEnvironment.
  let oldEnv = realm.getRunningContext().lexicalEnvironment;

  // 2. Let V be undefined.
  let V: Value = realm.intrinsics.undefined;

  // 3. Let destructuring be IsDestructuring of lhs.
  let destructuring = IsDestructuring(lhs);

  // 4. If destructuring is true and if lhsKind is assignment, then
  if (destructuring && lhsKind === "assignment") {
    // a. Assert: lhs is a LeftHandSideExpression.

    // b. Let assignmentPattern be the parse of the source text corresponding to lhs using AssignmentPattern as the goal symbol.
  }

  // 5. Repeat
  while (true) {
    // a. Let nextResult be ? IteratorStep(iterator).
    let nextResult = IteratorStep(realm, iterator);

    // b. If nextResult is false, return NormalCompletion(V).
    if (!nextResult) return V;

    // c. Let nextValue be ? IteratorValue(nextResult).
    let nextValue = IteratorValue(realm, nextResult);

    // d. If lhsKind is either assignment or varBinding, then
    let iterationEnv : LexicalEnvironment;
    let lhsRef;
    if (lhsKind === "assignment" || lhsKind === "varBinding") {
      // i. If destructuring is false, then
      if (!destructuring) {
        // 1. Let lhsRef be the result of evaluating lhs. (It may be evaluated repeatedly.)
        lhsRef = env.evaluateCompletion(lhs, strictCode);
      }
    } else { // e. Else,
      // i. Assert: lhsKind is lexicalBinding.
      invariant(lhsKind === "lexicalBinding", "expected lhsKind to be lexicalBinding");
      invariant(lhs.type === "VariableDeclaration");

      // ii. Assert: lhs is a ForDeclaration.

      // iii. Let iterationEnv be NewDeclarativeEnvironment(oldEnv).
      iterationEnv = NewDeclarativeEnvironment(realm, oldEnv);

      // iv. Perform BindingInstantiation for lhs passing iterationEnv as the argument.
      BindingInstantiation(realm, lhs, iterationEnv);

      // v. Set the running execution context's LexicalEnvironment to iterationEnv.
      realm.getRunningContext().lexicalEnvironment = iterationEnv;
      env = iterationEnv;

      // vi. If destructuring is false, then
      if (!destructuring) {
        let names = BoundNames(realm, lhs);

        // 1. Assert: lhs binds a single name.
        invariant(names.length === 1, "expected single name");

        // 2. Let lhsName be the sole element of BoundNames of lhs.
        let lhsName = names[0];

        // 3. Let lhsRef be ! ResolveBinding(lhsName).
        lhsRef = ResolveBinding(realm, lhsName, strictCode);
      }
    }

    // f. If destructuring is false, then
    let status;
    try {
      if (!destructuring) {
        // i. If lhsRef is an abrupt completion, then
        if (lhsRef instanceof AbruptCompletion) {
          // 1. Let status be lhsRef.
          status = lhsRef;
        } else if (lhsKind === "lexicalBinding") { // ii. Else if lhsKind is lexicalBinding, then
          // 1. Let status be InitializeReferencedBinding(lhsRef, nextValue).
          invariant(lhsRef instanceof Reference);
          status = InitializeReferencedBinding(realm, lhsRef, nextValue);
        } else { // iii. Else,
          // 1. Let status be PutValue(lhsRef, nextValue).
          invariant(lhsRef !== undefined);
          status = PutValue(realm, lhsRef, nextValue);
        }
      } else { // g. Else,
        // i. If lhsKind is assignment, then
        if (lhsKind === "assignment") {
          // 1. Let status be the result of performing DestructuringAssignmentEvaluation of assignmentPattern using nextValue as the argument.
        } else if (lhsKind === "varBinding") { // ii. Else if lhsKind is varBinding, then
          // 1. Assert: lhs is a ForBinding.

          // 2. Let status be the result of performing BindingInitialization for lhs passing nextValue and undefined as the arguments.
          status = BindingInitialization(realm, lhs, nextValue, undefined);
        } else { // iii. Else,
          // 1. Assert: lhsKind is lexicalBinding.
          invariant(lhsKind === "lexicalBinding");

          // 2. Assert: lhs is a ForDeclaration.

          // 3. Let status be the result of performing BindingInitialization for lhs passing nextValue and iterationEnv as arguments.
          invariant(iterationEnv !== undefined);
          status = BindingInitialization(realm, lhs, nextValue, iterationEnv);
        }
      }
    } catch (e) {
      if (e instanceof AbruptCompletion) {
        status = e;
      } else {
        throw e;
      }
    }

    // h. If status is an abrupt completion, then
    if (status instanceof AbruptCompletion) {
      // i. Set the running execution context's LexicalEnvironment to oldEnv.
      realm.getRunningContext().lexicalEnvironment = oldEnv;

      // ii. Return ? IteratorClose(iterator, status).
      throw IteratorClose(realm, iterator, status);
    }

    // i. Let result be the result of evaluating stmt.
    let result = env.evaluateCompletion(stmt, strictCode);

    // j. Set the running execution context's LexicalEnvironment to oldEnv.
    realm.getRunningContext().lexicalEnvironment = oldEnv;
    env = oldEnv;

    // k. If LoopContinues(result, labelSet) is false, return ? IteratorClose(iterator, UpdateEmpty(result, V)).
    if (!LoopContinues(realm, result, labelSet)) {
      invariant(result instanceof AbruptCompletion);
      result = UpdateEmpty(realm, result, V);
      invariant(result instanceof AbruptCompletion);
      throw IteratorClose(realm, iterator, result);
    }

    // l. If result.[[Value]] is not empty, let V be result.[[Value]].
    let resultValue = InternalGetResultValue(realm, result);
    if (!(resultValue instanceof EmptyValue)) V = resultValue;
  }

  invariant(false);
}

// ECMA262 13.7.5.11
export default function (ast: BabelNodeForOfStatement, strictCode: boolean, env: LexicalEnvironment, realm: Realm, labelSet: ?Array<string>): Value | Reference {
  let { left, right, body } = ast;

  if (left.type === "VariableDeclaration") {
    if (left.kind === "var") { // for (var ForBinding o fAssignmentExpression) Statement
      // 1. Let keyResult be the result of performing ? ForIn/OfHeadEvaluation(?? ??, AssignmentExpression, iterate).
      let keyResult = ForInOfHeadEvaluation(realm, env, [], right, "iterate", strictCode);

      // 2. Return ? ForIn/OfBodyEvaluation(ForBinding, Statement, keyResult, varBinding, labelSet).
      return ForInOfBodyEvaluation(realm, env, left.declarations[0].id, body, keyResult, "varBinding", labelSet, strictCode);
    } else { // for (ForDeclaration of AssignmentExpression) Statement
      // 1. Let keyResult be the result of performing ? ForIn/OfHeadEvaluation(BoundNames of ForDeclaration, AssignmentExpression, iterate).
      let keyResult = ForInOfHeadEvaluation(realm, env, BoundNames(realm, left), right, "iterate", strictCode);

      // 2. Return ? ForIn/OfBodyEvaluation(ForDeclaration, Statement, keyResult, lexicalBinding, labelSet).
      return ForInOfBodyEvaluation(realm, env, left, body, keyResult, "lexicalBinding", labelSet, strictCode);
    }
  } else { // for (LeftHandSideExpression of AssignmentExpression) Statement
    // 1. Let keyResult be the result of performing ? ForIn/OfHeadEvaluation(?? ??, AssignmentExpression, iterate).
    let keyResult = ForInOfHeadEvaluation(realm, env, [], right, "iterate", strictCode);

    // 2. Return ? ForIn/OfBodyEvaluation(LeftHandSideExpression, Statement, keyResult, assignment, labelSet).
    return ForInOfBodyEvaluation(realm, env, left, body, keyResult, "assignment", labelSet, strictCode);
  }
}

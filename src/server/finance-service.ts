import { convertMoney, splitExpense, calculateBalances } from "@/domain/money";
import type {
  Expense,
  Split,
  Settlement,
  Participant,
  Item,
} from "@/domain/types";
import { one, many, run, insert, update } from "./db";
import { AppError, requireValue } from "./errors";
import * as v from "./validation";
import {
  access,
  checkVersion,
  getTrip,
  log,
  revision,
  tx,
  uid,
  type Actor,
} from "./service-core";
import { snapshot } from "./trip-service";

export function balances(tripId: string, actor: Actor) {
  const data = snapshot(tripId, actor, "expenses");
  return calculateBalances(
    data.participants.map((p) => p.id),
    data.expenses,
    data.settlements,
  );
}

function person(tripId: string, id: string, allowInactive = false) {
  const p = requireValue(
    one<Participant>(
      "SELECT * FROM trip_participants WHERE id=? AND tripId=?",
      id,
      tripId,
    ),
    "同行者不属于此行程",
  );
  if (!allowInactive && p.status !== "active")
    throw new AppError(
      400,
      "INACTIVE_PARTICIPANT",
      "已停用同行者不能参与新费用",
    );
  return p;
}
export function saveExpense(
  tripId: string,
  actor: Actor,
  body: unknown,
  expenseId?: string,
) {
  const parsed = expenseId
    ? v.expenseInput.extend({ expectedVersion: v.version }).parse(body)
    : v.expenseInput.parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const original = expenseId
      ? requireValue(
          one<Expense>(
            "SELECT * FROM expenses WHERE id=? AND tripId=?",
            expenseId,
            tripId,
          ),
        )
      : null;
    if (original && "expectedVersion" in parsed)
      checkVersion(original, parsed.expectedVersion as number);
    const data = v.expenseInput.parse(
      Object.fromEntries(
        Object.entries(parsed).filter(([k]) => k !== "expectedVersion"),
      ),
    );
    const oldPeople = original
      ? many<Split>(
          "SELECT * FROM expense_splits WHERE expenseId=?",
          original.id,
        )
          .map((s) => s.participantId)
          .concat(original.payerParticipantId)
      : [];
    person(
      tripId,
      data.payerParticipantId,
      oldPeople.includes(data.payerParticipantId),
    );
    for (const s of data.splitMeta)
      person(tripId, s.participantId, oldPeople.includes(s.participantId));
    if (data.dayId)
      requireValue(
        one("SELECT id FROM days WHERE id=? AND tripId=?", data.dayId, tripId),
        "日期不属于此行程",
      );
    if (data.dayItemId) {
      const item = requireValue(
        one<Item>(
          "SELECT i.* FROM day_items i JOIN days d ON d.id=i.dayId WHERE i.id=? AND d.tripId=?",
          data.dayItemId,
          tripId,
        ),
        "事项不属于此行程",
      );
      if (data.dayId && data.dayId !== item.dayId)
        throw new AppError(400, "VALIDATION", "事项与日期不一致");
      data.dayId = item.dayId;
    }
    const trip = getTrip(tripId);
    let baseAmountMinor: number, normalized: ReturnType<typeof splitExpense>;
    try {
      baseAmountMinor = convertMoney(
        data.amountMinor,
        data.currency,
        trip.baseCurrency,
        data.exchangeRateToBase,
      );
      normalized = splitExpense(
        data.amountMinor,
        baseAmountMinor,
        data.currency,
        data.splitMethod,
        data.splitMeta,
      );
    } catch (e) {
      throw new AppError(400, "INVALID_MONEY", (e as Error).message);
    }
    const id = expenseId ?? uid();
    if (original) {
      update("expenses", id, {
        ...data,
        baseAmountMinor,
        version: original.version + 1,
        updatedAt: Date.now(),
        updatedByUserId: actor.id,
      });
      run("DELETE FROM expense_splits WHERE expenseId=?", id);
    } else
      insert("expenses", {
        id,
        tripId,
        ...data,
        baseAmountMinor,
        createdByUserId: actor.id,
        ...revision(actor),
      });
    for (const s of normalized)
      insert("expense_splits", {
        id: uid(),
        expenseId: id,
        ...s,
        createdAt: Date.now(),
      });
    run(
      "UPDATE trips SET baseCurrencyLockedAt=coalesce(baseCurrencyLockedAt,?), updatedAt=? WHERE id=?",
      Date.now(),
      Date.now(),
      tripId,
    );
    // Check aggregate overflow inside the transaction, so invalid ledgers roll back.
    for (const total of many<{ amount: number }>(
      "SELECT sum(amountMinor) amount FROM expenses WHERE tripId=? GROUP BY currency",
      tripId,
    ))
      if (!Number.isSafeInteger(total.amount))
        throw new AppError(
          400,
          "INVALID_MONEY",
          "此币种累计金额超出可安全计算范围",
        );
    balances(tripId, actor);
    log(
      tripId,
      actor,
      original ? "expense.updated" : "expense.created",
      "expense",
      id,
      `${original ? "修改" : "添加"}了费用「${data.title}」`,
    );
    return { id };
  });
}
export function deleteExpense(id: string, actor: Actor, expected: number) {
  return tx(() => {
    const e = requireValue(
      one<Expense>("SELECT * FROM expenses WHERE id=?", id),
    );
    access(e.tripId, actor, "edit");
    checkVersion(e, expected);
    run("DELETE FROM comments WHERE targetType='expense' AND targetId=?", id);
    run("DELETE FROM expenses WHERE id=?", id);
    log(
      e.tripId,
      actor,
      "expense.deleted",
      "expense",
      id,
      `删除了费用「${e.title}」`,
    );
    return { deleted: true };
  });
}
export function createSettlement(tripId: string, actor: Actor, body: unknown) {
  const data = v.settlementInput.parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    person(tripId, data.fromParticipantId, true);
    person(tripId, data.toParticipantId, true);
    if (data.fromParticipantId === data.toParticipantId)
      throw new AppError(400, "VALIDATION", "转出人与收款人不能相同");
    let baseAmountMinor: number;
    try {
      baseAmountMinor = convertMoney(
        data.amountMinor,
        data.currency,
        getTrip(tripId).baseCurrency,
        data.exchangeRateToBase,
      );
    } catch (e) {
      throw new AppError(400, "INVALID_MONEY", (e as Error).message);
    }
    const id = uid();
    insert("settlements", {
      id,
      tripId,
      ...data,
      baseAmountMinor,
      createdByUserId: actor.id,
      ...revision(actor),
    });
    run(
      "UPDATE trips SET baseCurrencyLockedAt=coalesce(baseCurrencyLockedAt,?) WHERE id=?",
      Date.now(),
      tripId,
    );
    balances(tripId, actor);
    log(
      tripId,
      actor,
      "settlement.created",
      "settlement",
      id,
      "登记了一笔实际转账",
    );
    return { id };
  });
}
export function deleteSettlement(id: string, actor: Actor, expected: number) {
  return tx(() => {
    const s = requireValue(
      one<Settlement>("SELECT * FROM settlements WHERE id=?", id),
    );
    access(s.tripId, actor, "edit");
    checkVersion(s, expected);
    run("DELETE FROM settlements WHERE id=?", id);
    log(
      s.tripId,
      actor,
      "settlement.deleted",
      "settlement",
      id,
      "删除了一笔转账记录",
    );
    return { deleted: true };
  });
}

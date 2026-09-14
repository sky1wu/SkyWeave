import type { Expense } from "@/domain/types";
import { one } from "../db";
import { requireValue } from "../errors";
import {
  balances,
  createSettlement,
  deleteExpense,
  deleteSettlement,
  saveExpense,
} from "../finance-service";
import { snapshot } from "../trip-service";
import { expectedVersion, UNHANDLED, type ApiDispatcher } from "./dispatcher";

export const dispatchFinance: ApiDispatcher = ({
  root,
  id,
  action,
  method,
  user,
  data,
}) => {
  if (root === "trips" && action === "expenses") {
    if (method === "GET") return snapshot(id, user, "expenses").expenses;
    if (method === "POST") return saveExpense(id, user, data);
  } else if (root === "expenses" && !action) {
    if (method === "PATCH") {
      const expense = requireValue(
        one<Expense>("SELECT * FROM expenses WHERE id=?", id),
      );
      return saveExpense(expense.tripId, user, data, id);
    }
    if (method === "DELETE")
      return deleteExpense(id, user, expectedVersion(data));
  } else if (root === "trips" && action === "balances" && method === "GET")
    return balances(id, user);
  else if (root === "trips" && action === "settlements" && method === "POST")
    return createSettlement(id, user, data);
  else if (root === "settlements" && method === "DELETE")
    return deleteSettlement(id, user, expectedVersion(data));
  return UNHANDLED;
};

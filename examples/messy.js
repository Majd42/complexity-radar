// A deliberately over-complex file for demonstrating Complexity Radar.

function classifyTransaction(tx) {
  if (tx.type === "refund") {
    if (tx.amount > 1000 && tx.currency === "USD") {
      return "large-refund";
    } else if (tx.amount > 100 || tx.flagged) {
      return "medium-refund";
    } else {
      return "small-refund";
    }
  } else if (tx.type === "purchase") {
    for (const item of tx.items) {
      if (item.restricted && !tx.approved) {
        return "blocked";
      }
      switch (item.category) {
        case "alcohol":
        case "tobacco":
          if (tx.customerAge < 21) return "age-restricted";
          break;
        case "pharmacy":
          if (!tx.prescription) return "needs-prescription";
          break;
        default:
          break;
      }
    }
    return tx.amount > 5000 ? "high-value" : "normal";
  }
  return "unknown";
}

const isEligible = (user) =>
  user.active && (user.plan === "pro" || user.plan === "enterprise") && !user.banned;

class Cart {
  total(items) {
    let sum = 0;
    for (const it of items) {
      if (it.discount) {
        sum += it.price * (1 - it.discount);
      } else {
        sum += it.price;
      }
    }
    return sum;
  }
}

module.exports = { classifyTransaction, isEligible, Cart };

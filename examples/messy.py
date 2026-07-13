"""Deliberately tangled Python for demonstrating Complexity Radar."""


def grade(score, attendance, extra_credit):
    if score >= 90 and attendance > 0.8:
        return "A"
    elif score >= 80 or (score >= 75 and extra_credit):
        if attendance < 0.5:
            return "B-"
        return "B"
    elif score >= 70:
        for bonus in extra_credit or []:
            if bonus == "project" and attendance > 0.9:
                return "C+"
        return "C"
    else:
        return "F"


def summarize(records):
    total = 0
    for r in records:
        if r.get("valid") and not r.get("archived"):
            total += r["value"]
    return total

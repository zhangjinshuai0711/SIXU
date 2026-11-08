import json


def make_group(scale, shared=[]):
    funcs = []
    for offset in range(3):
        def op(x, history=shared):
            history.append(scale * x + offset)
            return sum(history)
        funcs.append(op)
    return funcs, shared


f, s = make_group(1)
g, t = make_group(10)

out = [f[0](1), g[1](1)]
snapshot = s[:]
s.append(100)
out.append(f[2](0))
t[:] = t[-2:]
out.append(g[0](2))
out.append(f[1](-1))
s = s + [7]
out.append(g[2](0))

print(json.dumps({
    "out": out,
    "snapshot": snapshot,
    "s": s,
    "t": t,
    "same": s is t,
}))

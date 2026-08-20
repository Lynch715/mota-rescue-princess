"""从最终 HTML 解析 MAPS / MON,检查地图合法性并贪心模拟通关。"""
import re, json, math, sys, collections

SRC = "/sessions/affectionate-nifty-hamilton/mnt/outputs/魔塔-拯救公主.html"
html = open(SRC, encoding="utf-8").read()

# ---- 解析 MAPS ----
m = re.search(r"const MAPS = \[(.*?)\];", html, re.S)
maps = []
for line in m.group(1).strip().splitlines():
    line = line.strip().rstrip(",")
    if not line.startswith("["):
        continue
    maps.append(json.loads(line))

# ---- 解析 MON ----
mon = {}
for mm in re.finditer(r"(\d+)\s*:\s*\[\"([^\"]+)\",\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*\[([^\]]*)\]\]", html):
    i = int(mm.group(1))
    abil = [a.strip().strip('"') for a in mm.group(7).split(",") if a.strip()]
    mon[i] = dict(name=mm.group(2), hp=int(mm.group(3)), atk=int(mm.group(4)),
                  df=int(mm.group(5)), gold=int(mm.group(6)), ab=abil)

MCH = {'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
       'A':10,'B':11,'C':12,'E':13,'Z':14}
ITEM = {'k':('yk',1),'l':('bk',1),'m':('rk',1),'p':('hp',250),'P':('hp',600),
        'g':('atk',5),'d':('def',5),'s':('atk',15),'t':('def',15),
        'n':('atk',25),'o':('def',25),'w':('atk',45),'v':('def',45)}
DOOR = {'y':'yk','b':'bk','r':'rk'}
PASS = set('.@UDFMTX')

# ---- 结构检查 ----
errs = []
if len(maps) != 12:
    errs.append(f"楼层数 {len(maps)} != 12")
for f, g in enumerate(maps):
    if len(g) != 11:
        errs.append(f"F{f+1} 行数 {len(g)}")
    for r, row in enumerate(g):
        if len(row) != 11:
            errs.append(f"F{f+1} 第{r}行长度 {len(row)}: {row!r}")
    for r in (0, 10):
        if set(g[r]) != {'#'}:
            errs.append(f"F{f+1} 第{r}行边界不是墙")
    for r in range(11):
        if g[r][0] != '#' or g[r][10] != '#':
            errs.append(f"F{f+1} 第{r}行左右边界不是墙")
    up = sum(row.count('U') for row in g)
    dn = sum(row.count('D') for row in g)
    if f < 11 and up != 1:
        errs.append(f"F{f+1} 上楼梯数量 {up}")
    if f > 0 and dn != 1:
        errs.append(f"F{f+1} 下楼梯数量 {dn}")
if sum(row.count('@') for g in maps for row in g) != 1:
    errs.append("起点数量不为 1")
if sum(row.count('X') for g in maps for row in g) != 1:
    errs.append("公主数量不为 1")

print("=== 结构检查 ===")
print("通过" if not errs else "\n".join(errs))
if errs:
    sys.exit(1)

# ---- 战斗公式(与 HTML 保持一致) ----
def dmg(mid, st):
    m = mon[mid]
    pd = st['atk'] - m['df']
    if pd <= 0:
        return None
    rounds = math.ceil(m['hp'] / pd)
    edef = st['def'] // 2 if 'magic' in m['ab'] else st['def']
    md = max(0, m['atk'] - edef)
    if 'double' in m['ab']:
        md *= 2
    hits = rounds if 'first' in m['ab'] else rounds - 1
    d = hits * md
    if 'drain' in m['ab']:
        d += st['hp'] * 15 // 100
    return d

# ---- 贪心求解 ----
grid = [[list(r) for r in g] for g in maps]
start = None
for f in range(12):
    for r in range(11):
        for c in range(11):
            if grid[f][r][c] == '@':
                start = (f, r, c)
                grid[f][r][c] = '.'
st = dict(hp=1000, atk=10, def_=10, yk=1, bk=0, rk=0, gold=0)
st['def'] = st.pop('def_')
pos = start
log = []
shop_cnt = [0, 0, 0]
SHOP = [(20, 'hp', 500), (30, 'atk', 4), (30, 'def', 4)]
have_shop = False


def reach(pos):
    """返回从 pos 可达的格子集合(不穿门/怪)"""
    seen = {pos}
    q = collections.deque([pos])
    while q:
        f, r, c = q.popleft()
        ch = grid[f][r][c]
        if ch in 'UD':
            nf = f + (1 if ch == 'U' else -1)
            tgt = 'D' if ch == 'U' else 'U'
            for rr in range(11):
                for cc in range(11):
                    if grid[nf][rr][cc] == tgt and (nf, rr, cc) not in seen:
                        seen.add((nf, rr, cc)); q.append((nf, rr, cc))
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < 11 and 0 <= nc < 11):
                continue
            n = (f, nr, nc)
            if n in seen:
                continue
            t = grid[f][nr][nc]
            if t in PASS or t in ITEM:
                seen.add(n); q.append(n)
    return seen


min_hp = st['hp']
turn = 0
while True:
    turn += 1
    if turn > 4000:
        print("求解器超时"); sys.exit(1)
    cells = reach(pos)
    progressed = False
    # 1) 捡所有能捡的
    for (f, r, c) in sorted(cells):
        ch = grid[f][r][c]
        if ch in ITEM:
            k, v = ITEM[ch]
            st[k] += v
            grid[f][r][c] = '.'
            pos = (f, r, c); progressed = True
        elif ch == 'T':
            grid[f][r][c] = '.'; pos = (f, r, c); progressed = True
        elif ch == 'F':
            grid[f][r][c] = '.'; pos = (f, r, c); progressed = True
        elif ch == 'M':
            have_shop = True
        elif ch == 'X':
            print("\n=== 通关 ===")
            print(f"最低生命 {min_hp} · 终局 命{st['hp']} 攻{st['atk']} 防{st['def']} 金{st['gold']}")
            seenf=set(); rows=[]
            for (ff, line) in log:
                if ff not in seenf: seenf.add(ff); rows.append(line)
            print("--- 每层首战时的状态 ---"); print("\n".join(rows))
            sys.exit(0)
    if progressed:
        continue
    # 2) 打得过且不致死的怪(挑伤害最低的)
    best = None
    for (f, r, c) in sorted(cells):
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < 11 and 0 <= nc < 11):
                continue
            ch = grid[f][nr][nc]
            if ch in MCH:
                d = dmg(MCH[ch], st)
                if d is not None and d < st['hp']:
                    if best is None or d < best[0]:
                        best = (d, f, nr, nc, MCH[ch])
    if best:
        d, f, r, c, mid = best
        st['hp'] -= d; st['gold'] += mon[mid]['gold']
        min_hp = min(min_hp, st['hp'])
        grid[f][r][c] = '.'; pos = (f, r, c)
        log.append((f, f"F{f+1} 击败{mon[mid]['name']:<5} -{d:<5} 余{st['hp']:<5} 攻{st['atk']} 防{st['def']}"))
        continue
    # 3) 开门
    opened = False
    for (f, r, c) in sorted(cells):
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < 11 and 0 <= nc < 11):
                continue
            ch = grid[f][nr][nc]
            if ch in DOOR and st[DOOR[ch]] > 0:
                st[DOOR[ch]] -= 1
                grid[f][nr][nc] = '.'
                pos = (f, r, c); opened = True
                break
        if opened:
            break
    if opened:
        continue
    # 4) 买东西
    if have_shop:
        bought = False
        for i, (base, k, v) in enumerate(SHOP):
            p = int(base * 1.5 ** shop_cnt[i])
            if st['gold'] >= p:
                st['gold'] -= p; st[k] += v; shop_cnt[i] += 1; bought = True
        if bought:
            continue
    break

print("\n=== 卡住 ===")
print(f"位置 F{pos[0]+1} {pos[1]},{pos[2]}")
print(f"命{st['hp']} 攻{st['atk']} 防{st['def']} 金{st['gold']} 黄{st['yk']} 蓝{st['bk']} 红{st['rk']}")
blockers = collections.Counter()
for (f, r, c) in reach(pos):
    for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < 11 and 0 <= nc < 11:
            ch = grid[f][nr][nc]
            if ch in MCH:
                d = dmg(MCH[ch], st)
                blockers[f"F{f+1} {mon[MCH[ch]]['name']} " + ("打不动" if d is None else f"伤害{d}")] += 1
            elif ch in DOOR:
                blockers[f"F{f+1} {ch}门"] += 1
for k, v in blockers.most_common(20):
    print(" ", k, "x", v)
print("\n".join(l for _,l in log[-10:]))

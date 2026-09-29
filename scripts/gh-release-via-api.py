#!/usr/bin/env python3
"""通过 GitHub REST API 推送代码并发布 Release（绕开被墙的 github.com）。

使用场景：本机无法直连 github.com（git push 超时/502），但 api.github.com 与
uploads.github.com 可达时，用本脚本等效完成 git push + tag + Release + 附件上传。

用法（在仓库根目录执行）：
    export GH_TOKEN=github_pat_xxx
    # 只推送代码 + 打 tag
    python3 scripts/gh-release-via-api.py --tag v0.4.13
    # 推送 + 发 Release（附件自动打包）
    python3 scripts/gh-release-via-api.py --tag v0.4.13 \
        --notes-file /tmp/release-notes.md \
        --plugin inkline.sketchplugin

要点：
- 文件差异比对用「本地 git blob 哈希 vs 远端 tree 条目哈希」，不依赖远端提交存在于本地
  （API 创建的提交与本地提交内容相同但 SHA 不同，本地无法 fetch，故不能按 SHA 比较）
- 提交内容取自 `git cat-file blob HEAD:path`，不受工作区脏改动影响
- token 只从环境变量读取，永不写入文件
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = 'https://api.github.com'
UPLOADS = 'https://uploads.github.com'


def http(method, url, token, payload=None, raw=None, ctype='application/json', timeout=300):
    data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('Content-Type', ctype)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def git(*args):
    return subprocess.check_output(['git'] + list(args)).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=os.environ.get('GH_REPO', 'cxf825/inkline'))
    ap.add_argument('--tag', required=True)
    ap.add_argument('--branch', default='main')
    ap.add_argument('--notes-file', help='Release 正文 markdown 文件；不给则只推代码 + 打 tag')
    ap.add_argument('--plugin', help='要打包上传的 .sketchplugin 目录（自动 ditto 打包同名 zip）')
    ap.add_argument('--title', help='Release 标题，默认 Inkline <tag>')
    args = ap.parse_args()

    token = os.environ.get('GH_TOKEN')
    if not token:
        sys.exit('缺少环境变量 GH_TOKEN')

    if git('status', '--porcelain').strip():
        print('警告：工作区有未提交改动，脚本只推送 HEAD 的内容')

    # 1) 远端分支当前位置
    st, info = http('GET', '%s/repos/%s/commits/%s' % (API, args.repo, args.branch), token)
    if st != 200:
        sys.exit('读取远端分支失败：%s %s' % (st, info))
    parent_sha = info['sha']
    base_tree = info['commit']['tree']['sha']
    print('远端 %s: %s' % (args.branch, parent_sha[:10]))

    # 2) 远端文件表（path -> blob sha）
    st, tree = http('GET', '%s/repos/%s/git/trees/%s?recursive=1' % (API, args.repo, base_tree), token)
    if st != 200:
        sys.exit('读取远端 tree 失败：%s %s' % (st, tree))
    remote = {e['path']: e['sha'] for e in tree['tree'] if e['type'] == 'blob'}

    # 3) 本地文件表（git blob sha 与 GitHub blob sha 同算法）
    local = {}
    for line in git('ls-tree', '-r', 'HEAD').splitlines():
        meta, path = line.split('\t', 1)
        mode, typ, sha = meta.split()
        local[path] = (sha, mode)

    changed = [p for p in local if remote.get(p) != local[p][0]]
    deleted = [p for p in remote if p not in local]
    if not changed and not deleted:
        print('远端已是最新，无需推送')
    else:
        print('待推送：新增/修改 %d 个，删除 %d 个' % (len(changed), len(deleted)))

    entries = []
    for path in changed:
        blob = subprocess.check_output(['git', 'cat-file', 'blob', 'HEAD:' + path])
        st, res = http('POST', '%s/repos/%s/git/blobs' % (API, args.repo), token, {
            'content': base64.b64encode(blob).decode(),
            'encoding': 'base64',
        })
        if st != 201:
            sys.exit('建 blob 失败 %s：%s %s' % (path, st, res))
        entries.append({'path': path, 'mode': local[path][1], 'type': 'blob', 'sha': res['sha']})
        print('  blob', path, res['sha'][:8])
    for path in deleted:
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})
        print('  delete', path)

    if entries:
        st, new_tree = http('POST', '%s/repos/%s/git/trees' % (API, args.repo), token, {
            'base_tree': base_tree, 'tree': entries,
        })
        if st != 201:
            sys.exit('建 tree 失败：%s %s' % (st, new_tree))
        st, commit = http('POST', '%s/repos/%s/git/commits' % (API, args.repo), token, {
            'message': git('log', '-1', '--pretty=%B'),
            'tree': new_tree['sha'],
            'parents': [parent_sha],
        })
        if st != 201:
            sys.exit('建 commit 失败：%s %s' % (st, commit))
        new_sha = commit['sha']
        st, ref = http('PATCH', '%s/repos/%s/git/refs/heads/%s' % (API, args.repo, args.branch), token,
                       {'sha': new_sha, 'force': True})
        if st != 200:
            sys.exit('更新分支失败：%s %s' % (st, ref))
        print('本次提交: %s  == 本地 %s（内容相同，SHA 因提交者信息不同而不同）' % (new_sha[:10], git('rev-parse', '--short=10', 'HEAD')))
    else:
        new_sha = parent_sha

    # 4) tag
    st, res = http('POST', '%s/repos/%s/git/refs' % (API, args.repo), token,
                   {'ref': 'refs/tags/' + args.tag, 'sha': new_sha})
    print('tag %s: %s' % (args.tag, '已创建' if st == 201 else res.get('message', st)))

    if not args.notes_file:
        print('DONE（未发 Release）')
        return

    # 5) Release
    body = open(args.notes_file, encoding='utf-8').read()
    st, rel = http('POST', '%s/repos/%s/releases' % (API, args.repo), token, {
        'tag_name': args.tag,
        'name': args.title or ('Inkline ' + args.tag),
        'body': body,
        'draft': False,
        'prerelease': False,
    })
    if st not in (200, 201):
        sys.exit('创建 Release 失败：%s %s' % (st, rel))
    print('Release:', rel['html_url'])

    # 6) 打包并上传附件
    if args.plugin:
        zip_name = '%s-%s.sketchplugin.zip' % (os.path.basename(args.plugin).replace('.sketchplugin', ''), args.tag)
        subprocess.check_call(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', args.plugin, zip_name])
        with open(zip_name, 'rb') as f:
            blob = f.read()
        st, asset = http('POST', '%s/repos/%s/releases/%s/assets?name=%s' % (UPLOADS, args.repo, rel['id'], zip_name),
                         token, raw=blob, ctype='application/zip')
        if st != 201:
            sys.exit('上传附件失败：%s %s' % (st, asset))
        print('附件: %s (%d KB) %s' % (asset['name'], asset['size'] // 1024, asset['browser_download_url']))

    print('DONE', new_sha)


if __name__ == '__main__':
    main()

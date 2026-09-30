#!/usr/bin/env python3
"""Development-only PTY checks; never launch a native terminal application."""
import errno
import fcntl
import json
import os
import pathlib
import pty
import select
import signal
import re
import struct
import subprocess
import termios
import time
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / ".workbench/p10"

def size(fd, columns, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))

def scenario(name, columns, rows, action, expected, env, command, resize=None, message=None):
    master, slave = pty.openpty()
    os.set_blocking(master,False)
    stop_read, stop_write = os.pipe()
    size(slave, columns, rows)
    before = termios.tcgetattr(slave)
    def start():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    controller = "import subprocess,os,sys; child=subprocess.Popen(sys.argv[2:]); print('P10_PID='+str(child.pid),flush=True); code=child.wait(); print('P10_EXIT='+str(code),flush=True); os.read(int(sys.argv[1]),1); sys.exit(code)"
    child = subprocess.Popen([sys.executable,"-c",controller,str(stop_read),*command], stdin=slave, stdout=slave, stderr=slave, cwd=ROOT, env=env, preexec_fn=start, close_fds=True,pass_fds=(stop_read,))
    output = bytearray()
    def read_until(predicate, seconds=10):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            ready, _, _ = select.select([master], [], [], min(0.05, max(0, deadline-time.monotonic())))
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except BlockingIOError:
                    continue
                except OSError as error:
                    if error.errno == errno.EIO:
                        return
                    raise
                if chunk:
                    output.extend(chunk)
            if child.poll() is not None and not ready:
                return
        raise AssertionError(name + " timed out")
    try:
        read_until(lambda: b"\x1b[2J" in output or b"P10_EXIT=" in output)
        product_pid = int(re.search(rb"P10_PID=(\d+)", output)[1])
        if action != "exception":
            assert child.poll() is None, name + " running"
            raw = termios.tcgetattr(slave)
            assert not (raw[3] & termios.ICANON), name + " raw input"
            assert b"\x1b[?1049h" in output and b"\x1b[?25l" in output, name + " enter"
            if message:
                assert message.encode() in output, name + " size message"
            if resize:
                output.clear()
                for width, height in resize:
                    size(slave, width, height)
                    os.kill(product_pid,signal.SIGWINCH)
                read_until(lambda: b"\x1b[2J" in output)
                # Final frame is checked after events have settled, not intermediate resize ordering.
                time.sleep(0.1)
            if action == "q":
                os.write(master, b"q")
            elif action == "etx":
                os.write(master, b"\x03")
            else:
                os.kill(product_pid,getattr(signal, action))
        read_until(lambda: b"P10_EXIT=" in output)
        code = int(re.search(rb"P10_EXIT=(-?\d+)", output)[1])
        after = termios.tcgetattr(slave)
        # macOS sets transient PENDIN when returning to canonical mode before input arrives.
        # Compare all persistent flags/control characters; PENDIN does not represent raw mode.
        stable_before, stable_after = before[:], after[:]
        stable_before[3] &= ~getattr(termios,"PENDIN",0)
        stable_after[3] &= ~getattr(termios,"PENDIN",0)
        assert stable_after == stable_before, name + " terminal flags restored"
        os.write(stop_write,b"x")
        assert child.wait(timeout=2) == code
        # Collect any remaining restoration bytes.
        while select.select([master], [], [], 0.05)[0]:
            try:
                chunk = os.read(master, 65536)
            except (BlockingIOError,OSError):
                break
            if not chunk:
                break
            output.extend(chunk)
        assert code == expected, (name, code, expected)
        assert b"\x1b[?25h\x1b[0m\x1b[?1049l" in output, name + " cursor/reset/alternate restoration"
        assert b"Error:" not in output and b"file://" not in output, name + " safe output"
        frames = output.split(b"\x1b[H\x1b[2J")[1:]
        # Actual product dimensions are also covered by render tests (Unicode cell widths).
        if name in ("120x32", "80x24"):
            body = frames[0].split(b"\x1b[?25h")[0].decode().replace("\r", "")
            assert len(body.split("\n")) <= rows-1, name + " last row reserved"
        print(json.dumps({"completed":name,"exit":code}),flush=True)
        return {"name":name,"columns":columns,"rows":rows,"exit":code,"restored":True,"bytes":len(output),"frames":len(frames)}
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=2)
        os.close(master)
        os.close(slave)
        os.close(stop_read)
        os.close(stop_write)

def main():
    receipt = json.loads((WORK / "installed-receipt.json").read_text())
    env = dict(os.environ, **receipt["env"], TERM="xterm-256color", ORACLE_BROWSER_MAX_CONCURRENT_TABS="")
    bin_path = receipt["bin"]
    package = pathlib.Path(bin_path).resolve().parent
    harness = WORK / "tty-exception.mjs"
    harness.write_text('import {runTui,createNodeTuiDependencies} from '+json.dumps((package / "tui.js").as_uri())+';\n'
        'const deps=createNodeTuiDependencies({cwd:process.cwd(),osHome:process.env.HOME,env:{...process.env}});\n'
        'deps.collect=async()=>{throw new Error("Synthetic controlled exception")};\n'
        'process.exitCode=await runTui(deps,2000);\n')
    cases = []
    for name, width, height, action, code, message in [
        ("120x32",120,32,"q",0,None),("80x24",80,24,"q",0,None),
        ("narrow",40,24,"q",0,"!"),("short",120,10,"q",0,"Terminal too short"),
        ("etx",120,32,"etx",130,None),("sigint",120,32,"SIGINT",130,None),
        ("sigterm",120,32,"SIGTERM",143,None)]:
        cases.append(scenario(name,width,height,action,code,env,[bin_path],message=message))
    cases.append(scenario("resize",120,32,"q",0,env,[bin_path],resize=[(80,24),(40,24),(120,32)]))
    cases.append(scenario("exception",120,32,"exception",1,env,["node",str(harness)]))
    result={"scope":"automated PTY; native screen/shell input unverified","tarballSha256":receipt["tarballSha256"],
        "sourceSha256":receipt["sourceSha256"],"cases":cases}
    (WORK / "tty-result.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result))

if __name__ == "__main__":
    main()

import { DebugConfiguration, debug, window, workspace } from "vscode";
import { inspectEvalCommands } from "./inspect-eval-commands";
import { Command } from "../../core/command";
import {
  AbsolutePath,
  activeWorkspacePath,
  workspaceRelativePath,
} from "../../core/path";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";
import { inspectVersion } from "../../inspect";
import { inspectBinPath } from "../../inspect/props";
import { activeWorkspaceFolder } from "../../core/workspace";
import { findOpenPort } from "../../core/port";

export function activateEvalManager(
  stateManager: WorkspaceStateManager
): [Command[], InspectEvalManager] {
  const inspectEvalMgr = new InspectEvalManager(stateManager);
  return [inspectEvalCommands(inspectEvalMgr), inspectEvalMgr];
}

export class InspectEvalManager {
  constructor(private readonly stateManager_: WorkspaceStateManager) {
  }

  public async startEval(file: AbsolutePath, task?: string, debug = false) {
    // if we don't have inspect bail and let the user know
    if (!inspectVersion()) {
      await window.showWarningMessage(
        `Unable to ${debug ? "Debug" : "Run"
        } Eval (Inspect Package Not Installed)`,
        {
          modal: true,
          detail: "pip install --upgrade inspect-ai",
        }
      );
      return;
    }

    const workspaceDir = activeWorkspacePath();
    const relativePath = workspaceRelativePath(file);

    // The base set of task args
    const taskArg = task ? `${relativePath}@${task}` : relativePath;
    const args = ["eval", taskArg];

    // Read the document state to determine flags
    const docState = this.stateManager_.getTaskState(file.path, task);

    // Forward the various doc state args
    const limit = docState.limit;
    if (
      debug === true &&
      workspace.getConfiguration("inspect_ai").get("debugSingleSample")
    ) {
      args.push(...["--limit", "1"]);
    } else if (limit) {
      args.push(...["--limit", limit]);
    }

    const epochs = docState.epochs;
    if (epochs) {
      args.push(...["--epochs", epochs]);
    }

    const temperature = docState.temperature;
    if (temperature) {
      args.push(...["--temperature", temperature]);
    }

    const maxTokens = docState.maxTokens;
    if (maxTokens) {
      args.push(...["--max-tokens", maxTokens]);
    }

    const topP = docState.topP;
    if (topP) {
      args.push(...["--top-p", topP]);
    }

    const topK = docState.topK;
    if (topK) {
      args.push(...["--top-k", topK]);
    }

    // Forwards task params
    const taskParams = docState.params;
    if (taskParams) {
      Object.keys(taskParams).forEach((key) => {
        const value = taskParams[key];
        args.push(...["-T", `${key}=${value}`]);
      });
    }

    // If we're debugging, launch using the debugger
    if (debug) {

      // Handle debugging
      let debugPort = 5678;
      if (debug === true) {
        // Provision a port
        debugPort = await findOpenPort(debugPort);

        args.push("--debug-port");
        args.push(debugPort.toString());
      }

      await runDebugger(inspectBinPath()?.path || "inspect", args, workspaceDir.path, debugPort);
    } else {
      // Run the command
      runEvalCmd(args, workspaceDir.path, this.stateManager_);
    }
  }
}

const runEvalCmd = (args: string[], cwd: string, stateManager: WorkspaceStateManager) => {
  // See if there a non-busy terminal that we can re-use
  const name = "Inspect Eval";
  let terminal = window.terminals.find((t) => {
    return t.name === name;
  });
  if (!terminal) {
    terminal = window.createTerminal({ name, cwd, env: { ["INSPECT_WORKSPACE_ID"]: stateManager.getWorkspaceInstance() } });
  }
  terminal.show();
  terminal.sendText(`cd ${cwd}`);
  terminal.sendText(["inspect", ...args].join(" "));
};

const runDebugger = async (program: string, args: string[], cwd: string, port: number) => {
  const name = "Inspect Eval";
  const debugConfiguration: DebugConfiguration = {
    name,
    type: "python",
    request: "launch",
    program,
    args,
    console: "internalConsole",
    cwd,
    port,
    "justMyCode": false
  };
  await debug.startDebugging(activeWorkspaceFolder(), debugConfiguration);
};

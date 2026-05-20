declare module "ssh2-sftp-client" {
  export interface ConnectOptions {
    host: string;
    port?: number;
    username: string;
    password?: string;
    readyTimeout?: number;
  }

  export default class Client {
    constructor(name?: string);
    connect(options: ConnectOptions): Promise<void>;
    put(input: string | Buffer | NodeJS.ReadableStream, remotePath: string): Promise<unknown>;
    mkdir(remotePath: string, recursive?: boolean): Promise<unknown>;
    stat(remotePath: string): Promise<unknown>;
    end(): Promise<void>;
  }
}

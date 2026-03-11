export function getRuntimeOsDisplayName(): string {
    switch (process.platform) {
        case 'win32':
            return 'Windows'
        case 'darwin':
            return 'Mac OS'
        case 'linux':
            return 'Linux'
        default:
            return process.platform
    }
}

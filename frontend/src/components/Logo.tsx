const dots: Array<[number, number]> = [
    [5.2, 2.4],
    [8, 2.4],
    [10.8, 2.4],
    [5.2, 5.2],
    [5.2, 8],
    [8, 8],
    [10.8, 8],
    [10.8, 10.8],
    [5.2, 13.6],
    [8, 13.6],
    [10.8, 13.6],
];

export function Logo({ className = "" }: { className?: string }) {
    return (
        <svg className={`logo ${className}`.trim()} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect className="logo-tile" width="16" height="16" rx="0" />
            {dots.map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="logo-dot" cx={cx} cy={cy} r="1" />
            ))}
        </svg>
    );
}

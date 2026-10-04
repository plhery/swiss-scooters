import Foundation
import MapKit
import SwiftUI
import UIKit

/// Colours for small text and filled controls. The system tints are too light
/// for that on glass; these keep a contrast of at least 4.5:1.
enum ScooterPalette {
    /// The app's blue under white text.
    static let actionFill = Color(red: 0, green: 0.42, blue: 0.9)
    /// Blue text on glass or on a blue tint.
    static let actionText = adaptive(
        light: UIColor(red: 0, green: 0.38, blue: 0.8, alpha: 1),
        dark: UIColor(red: 0.36, green: 0.69, blue: 1, alpha: 1)
    )
    static let warning = adaptive(
        light: UIColor(red: 0.54, green: 0.3, blue: 0, alpha: 1),
        dark: .systemOrange
    )
    static let good = adaptive(
        light: UIColor(red: 0.11, green: 0.47, blue: 0.2, alpha: 1),
        dark: .systemGreen
    )
    static let critical = adaptive(
        light: UIColor(red: 0.7, green: 0.15, blue: 0.12, alpha: 1),
        dark: .systemRed
    )
    /// Red under white text.
    static let criticalFill = Color(red: 0.76, green: 0.15, blue: 0.14)
    /// Grey for small text and its icons. The system's secondary label is
    /// about 3.5:1 on the light dock and on a light sheet; this is 5:1 there.
    /// In dark appearance it is the system's colour, which is light enough.
    /// How much black the glass over the map gets in dark appearance.
    static let darkGlassTint = 0.4
    static let secondaryText = adaptive(
        light: UIColor(red: 0.38, green: 0.39, blue: 0.42, alpha: 1),
        dark: UIColor.secondaryLabel.resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark))
    )

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

/// Liquid Glass for the dock and for what floats at the top of the map. In
/// dark appearance the map shows through too brightly for small text, so the
/// glass is tinted darker there.
private struct ChromeGlass<S: Shape>: ViewModifier {
    let shape: S
    let isInteractive: Bool
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        let glass = colorScheme == .dark
            ? Glass.regular.tint(Color.black.opacity(ScooterPalette.darkGlassTint))
            : Glass.regular
        content.glassEffect(glass.interactive(isInteractive), in: shape)
    }
}

extension View {
    func chromeGlass(in shape: some Shape, isInteractive: Bool = false) -> some View {
        modifier(ChromeGlass(shape: shape, isInteractive: isInteractive))
    }
}

struct ScooterControlDock: View {
    @Bindable var model: ScooterMapModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    private let maximumContentHeight: CGFloat
    private let onEditFilters: () -> Void
    private let onHeightChange: (CGFloat) -> Void

    init(
        model: ScooterMapModel,
        maximumContentHeight: CGFloat = .infinity,
        onEditFilters: @escaping () -> Void = {},
        onHeightChange: @escaping (CGFloat) -> Void = { _ in }
    ) {
        self.model = model
        self.maximumContentHeight = maximumContentHeight
        self.onEditFilters = onEditFilters
        self.onHeightChange = onHeightChange
    }

    var body: some View {
        let content = model.dock

        // Content taller than the room above the dock scrolls, as with large text.
        HeightLimit(maximum: maximumContentHeight) {
            ViewThatFits(in: .vertical) {
                dockContent(content)
                ScrollView(.vertical) {
                    dockContent(content)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: 560)
        .chromeGlass(in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 12, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { height in
            onHeightChange(height)
        }
        .animation(
            reduceMotion ? nil : .snappy(duration: 0.28, extraBounce: 0.06),
            value: content.kind
        )
        .sensoryFeedback(.selection, trigger: model.enabledProviders)
    }

    @ViewBuilder
    private func dockContent(_ content: ScooterDockContent) -> some View {
        switch content {
        case let .scooter(scooter):
            ScooterCard(model: model, scooter: scooter)
        case let .parking(parking):
            ParkingBayCard(model: model, parking: parking)
        case let .outOfDate(failure, lastUpdate):
            outOfDateCard(failure, lastUpdate: lastUpdate)
        case let .finding(chips):
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityHidden(true)
                    Text("Finding scooters…")
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity, minHeight: Self.headerHeight, alignment: .leading)

                if !chips.isEmpty {
                    providerChips(chips)
                }
            }
        case .waiting:
            Text("Waiting for scooter data")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: Self.headerHeight, alignment: .leading)
        case let .outsideCoverage(cities):
            outsideCoverageCard(cities)
        case let .filtersHideEverything(summary):
            hiddenByFiltersCard(summary)
        case let .summary(summary):
            summaryContent(summary)
        }
    }

    /// Count and status, and "Finding scooters…" in their place, keep one
    /// height so the dock does not jump while the map moves.
    private static let headerHeight: CGFloat = 38

    private func summaryContent(_ summary: ScooterDockSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            // Very large text leaves no room for the pill beside the count
            // and the status, so it goes under them.
            let header = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(spacing: 10))

            header {
                VStack(alignment: .leading, spacing: 1) {
                    countLine(summary)

                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        DockStatusLabel(status: summary.status(at: context.date))
                    }
                }
                .frame(
                    maxWidth: .infinity,
                    minHeight: Self.headerHeight,
                    alignment: .leading
                )

                if summary.showsTryAgain {
                    TryAgainPill(isLoading: model.isLoading, action: model.retryLoad)
                        .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: false)
                        .transition(.opacity)
                }
            }

            if !summary.notices.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(summary.notices) { notice in
                        DockNoteRow(systemImage: "exclamationmark.triangle", text: notice.text)
                    }
                }
            }

            providerChips(summary.chips)

            if let hint = summary.hint {
                DockNoteRow(
                    systemImage: hint == .tapCity ? "mappin.and.ellipse" : "scooter",
                    text: hint.text
                )
            }
        }
    }

    /// "22 scooters nearby": the count stands out, and the two are one
    /// text, so a long line wraps like a sentence.
    private func countLine(_ summary: ScooterDockSummary) -> some View {
        var count = AttributedString(summary.count.formatted(.number))
        count.swiftUI.font = .headline.weight(.bold).monospacedDigit()
        var label = AttributedString(" \(summary.countLabel)")
        label.swiftUI.font = .subheadline.weight(.semibold)

        return Text(count + label)
            .contentTransition(.numericText())
            .fixedSize(horizontal: false, vertical: true)
    }

    private func providerChips(_ chips: [ScooterProviderEntry]) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                QuickProviderFilterChip(
                    title: String(localized: "All"),
                    accessibilityTitle: String(localized: "All providers"),
                    count: model.allProviderCount,
                    color: nil,
                    isSelected: model.allProvidersSelected,
                    accessibilityIsShown: model.allProvidersSelected,
                    action: model.showAllProviders
                )

                ForEach(chips) { entry in
                    providerChip(entry)
                }
            }
            .animation(
                reduceMotion ? nil : .snappy(duration: 0.25),
                value: chips.map(\.provider)
            )
        }
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, 2, for: .scrollContent)
    }

    private func providerChip(_ entry: ScooterProviderEntry) -> some View {
        QuickProviderFilterChip(
            title: entry.provider.name,
            accessibilityTitle: entry.isDown ? entry.downLabel : entry.provider.name,
            count: entry.count,
            color: providerAccent(entry.provider, colorScheme: colorScheme),
            isSelected: entry.isSelected,
            isDown: entry.isDown,
            accessibilityIsShown: entry.isEnabled
        ) {
            model.toggleQuickProvider(entry.provider)
        }
        .accessibilityHint(quickProviderHint(entry.provider))
    }

    private func quickProviderHint(_ provider: ScooterProvider) -> String {
        if model.allProvidersSelected {
            return String(localized: "Shows only this provider")
        }
        if model.enabledProviders == [provider] {
            return String(localized: "Shows all providers")
        }
        if model.enabledProviders.contains(provider) {
            return String(localized: "Hides this provider")
        }
        return String(localized: "Adds this provider")
    }

    private func outOfDateCard(_ failure: ScooterLoadFailure, lastUpdate: Date) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DockCardHeader(
                systemImage: "clock",
                tint: ScooterPalette.warning,
                title: String(localized: "These positions are out of date"),
                message: ScooterDockStatus.outOfDateBody(failure, lastUpdate: lastUpdate)
            )

            DockActionRow {
                Button(action: model.retryLoad) {
                    ZStack {
                        Label("Try again", systemImage: "arrow.clockwise")
                            .opacity(model.isLoading ? 0 : 1)
                        if model.isLoading {
                            ProgressView()
                                .tint(.white)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(.white)
                }
                .dockActionStyle(prominent: true)
                .disabled(model.isLoading)
                .accessibilityLabel(String(localized: "Try again"))
            }
        }
    }

    private func outsideCoverageCard(_ cities: [ScooterCityDistance]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DockCardHeader(
                systemImage: "map",
                tint: ScooterPalette.actionText,
                title: String(localized: "No scooter data here yet"),
                message: String(localized: "Scooters covers selected cities in France, Switzerland, Germany and Italy.")
            )

            VStack(alignment: .leading, spacing: 8) {
                Text("Closest cities")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(ScooterPalette.secondaryText)
                    .accessibilityAddTraits(.isHeader)

                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(cities) { entry in
                        Button {
                            model.focusOnCity(entry.city)
                        } label: {
                            Label(entry.label, systemImage: "mappin.and.ellipse")
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .background(Color.primary.opacity(0.055), in: Capsule())
                                .overlay {
                                    Capsule().stroke(Color.secondary.opacity(0.16), lineWidth: 1)
                                }
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func hiddenByFiltersCard(_ summary: ScooterFilterSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DockCardHeader(
                systemImage: "line.3.horizontal.decrease",
                tint: ScooterPalette.actionText,
                title: summary.title,
                message: summary.body
            )

            DockActionRow {
                Button(action: model.resetFilters) {
                    // "Show all 1" reads badly; one hidden scooter gets the plain label.
                    Text(summary.hiddenCount == 1 ? String(localized: "Show all") : summary.showAllTitle)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                }
                .dockActionStyle(prominent: true)

                Button(action: onEditFilters) {
                    Text("Edit filters")
                        .frame(maxWidth: .infinity)
                }
                .dockActionStyle(prominent: false)
            }
        }
    }
}

private extension ScooterDockContent {
    /// What the dock shows, without its details: a change of kind animates.
    var kind: String {
        switch self {
        case let .scooter(scooter): "scooter:\(scooter.id)"
        case let .parking(parking): "parking:\(parking.id)"
        case .outOfDate: "outOfDate"
        case .finding: "finding"
        case .waiting: "waiting"
        case .outsideCoverage: "outsideCoverage"
        case .filtersHideEverything: "filtersHideEverything"
        case .summary: "summary"
        }
    }
}

/// Gives its content the height it asks for, up to a limit.
struct HeightLimit: Layout {
    let maximum: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        let ideal = content.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
        return CGSize(width: ideal.width, height: min(ideal.height, maximum))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(
            at: bounds.origin,
            proposal: ProposedViewSize(width: bounds.width, height: bounds.height)
        )
    }
}

/// Rows that wrap: pills and chips move to the next line when one is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    private struct Row {
        var sizes: [CGSize] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(for: subviews, width: proposal.width)
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var index = subviews.startIndex
        var y = bounds.minY
        for row in rows(for: subviews, width: bounds.width) {
            var x = bounds.minX
            for size in row.sizes {
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
                index = subviews.index(after: index)
            }
            y += row.height + lineSpacing
        }
    }

    private func rows(for subviews: Subviews, width: CGFloat?) -> [Row] {
        let available = width ?? .infinity
        var rows = [Row()]
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            var row = rows[rows.count - 1]
            if !row.sizes.isEmpty, row.width + spacing + size.width > available {
                row = Row()
                rows.append(row)
            }
            row.width += (row.sizes.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.sizes.append(size)
            rows[rows.count - 1] = row
        }
        return rows
    }
}

/// The status line under the count, and at the top of a card while data is
/// failing. It wraps rather than lose the time at its end.
private struct DockStatusLabel: View {
    let status: ScooterDockStatus

    var body: some View {
        HStack(spacing: 5) {
            if status.isLive {
                LiveIndicator()
            } else if status.isWarning {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption2.weight(.semibold))
                    .accessibilityHidden(true)
            }

            Text(status.text)
                .font(.caption)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(status.isWarning ? ScooterPalette.warning : ScooterPalette.secondaryText)
    }
}

/// A calm line in the dock: a small icon and secondary text.
private struct DockNoteRow: View {
    let systemImage: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: systemImage)
                .font(.caption2.weight(.semibold))
                .accessibilityHidden(true)
            Text(text)
                .font(.caption)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(ScooterPalette.secondaryText)
        .padding(.leading, 2)
    }
}

private struct TryAgainPill: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text("Try again")
                    .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(ScooterPalette.actionText)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(ScooterPalette.actionText.opacity(0.12), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .accessibilityLabel(String(localized: "Try again"))
    }
}

/// The head of a dock card: a tinted symbol, a title and the sentence under it.
private struct DockCardHeader: View {
    let systemImage: String
    let tint: Color
    let title: String
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DockSymbolTile(systemImage: systemImage, foreground: tint, tint: tint)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                if !message.isEmpty {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(ScooterPalette.secondaryText)
                }
            }
            .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct DockSymbolTile: View {
    let systemImage: String
    var foreground: Color = .primary
    let tint: Color
    var size: CGFloat = 44

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.43, weight: .semibold))
            .foregroundStyle(foreground)
            .frame(width: size, height: size)
            .background(
                tint.opacity(0.16),
                in: RoundedRectangle(cornerRadius: size / 3, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

/// One or two buttons whose labels stay on one line: side by side where
/// they fit, one above the other where they do not or the text is very large.
private struct DockActionRow<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        DockActionLayout(alwaysStacks: dynamicTypeSize.isAccessibilitySize) { content }
            .font(.subheadline.weight(.semibold))
            .controlSize(.large)
    }
}

/// Buttons share the row equally while every label fits on one line. When
/// equal shares are too narrow the last button takes the room the others
/// leave, and when that is too narrow as well each button gets a row.
private struct DockActionLayout: Layout {
    var spacing: CGFloat = 9
    var alwaysStacks = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let frames = frames(for: subviews, width: proposal.width)
        return CGSize(
            width: frames.map(\.maxX).max() ?? 0,
            height: frames.map(\.maxY).max() ?? 0
        )
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, frame) in zip(subviews, frames(for: subviews, width: bounds.width)) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func frames(for subviews: Subviews, width: CGFloat?) -> [CGRect] {
        // What each button needs to keep its label on one line.
        let ideal = subviews.map { $0.sizeThatFits(.unspecified).width }
        let widest = ideal.max() ?? 0
        let count = CGFloat(subviews.count)
        let gaps = spacing * max(0, count - 1)
        let available = width ?? widest * count + gaps

        var widths: [CGFloat]?
        if subviews.count == 1 || (!alwaysStacks && widest * count + gaps <= available + 0.5) {
            widths = Array(repeating: (available - gaps) / max(1, count), count: subviews.count)
        } else if !alwaysStacks, ideal.reduce(0, +) + gaps <= available + 0.5 {
            widths = ideal
            widths?[subviews.count - 1] = available - gaps - ideal.dropLast().reduce(0, +)
        }

        guard let widths else {
            var y: CGFloat = 0
            return subviews.map { subview in
                let height = subview.sizeThatFits(ProposedViewSize(width: available, height: nil)).height
                defer { y += height + spacing }
                return CGRect(x: 0, y: y, width: available, height: height)
            }
        }

        let height = zip(subviews, widths)
            .map { $0.sizeThatFits(ProposedViewSize(width: $1, height: nil)).height }
            .max() ?? 0
        var x: CGFloat = 0
        return widths.map { width in
            defer { x += width + spacing }
            return CGRect(x: x, y: 0, width: width, height: height)
        }
    }
}

private extension View {
    /// The filled button in the app's blue, or the quiet glass one beside it.
    @ViewBuilder
    func dockActionStyle(prominent: Bool) -> some View {
        if prominent {
            buttonStyle(.glassProminent)
                .tint(ScooterPalette.actionFill)
        } else {
            buttonStyle(.glass)
        }
    }

    func dockPill(_ foreground: Color = .primary, background: Color = Color(uiColor: .tertiarySystemFill)) -> some View {
        font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(minHeight: 32)
            .background(background, in: Capsule())
    }
}

private struct DockCloseButton: View {
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(ScooterPalette.secondaryText)
                .frame(width: 44, height: 44)
                .background(.quaternary, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// A scooter or bay card hides the dock's status line, so a failed refresh or
/// delayed data is reported here. Nothing shows while the data is healthy.
private struct CardStatusLine: View {
    let model: ScooterMapModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if let status = model.cardStatus {
            if dynamicTypeSize.isAccessibilitySize {
                // Very large text: the status keeps the whole width.
                VStack(alignment: .leading, spacing: 0) {
                    DockStatusLabel(status: status)
                    if status.isWarning {
                        tryAgain
                    }
                }
            } else {
                HStack(spacing: 8) {
                    DockStatusLabel(status: status)
                    Spacer(minLength: 4)
                    if status.isWarning {
                        tryAgain
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
                // The button keeps its 44 pt target; the line stays compact.
                .padding(.vertical, status.isWarning ? -8 : 0)
            }
        }
    }

    private var tryAgain: some View {
        Button(action: model.retryLoad) {
            Text("Try again")
                .font(.caption.weight(.semibold))
                .foregroundStyle(ScooterPalette.actionText)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.isLoading)
    }
}

private struct QuickProviderFilterChip: View {
    let title: String
    let accessibilityTitle: String
    let count: Int
    /// The provider's colour; nil for "All".
    let color: Color?
    let isSelected: Bool
    /// Not sharing data and none in view: dashed, with a warning instead of a count.
    var isDown = false
    let accessibilityIsShown: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                indicator

                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                if isDown {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ScooterPalette.warning)
                } else {
                    Text(count, format: .number)
                        .font(.caption2.weight(.bold))
                        .monospacedDigit()
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.quaternary, in: Capsule())
                        .contentTransition(.numericText())
                }
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(background, in: Capsule())
            .overlay {
                if isDown {
                    Capsule()
                        .strokeBorder(
                            Color.secondary.opacity(0.6),
                            style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                        )
                } else {
                    Capsule()
                        .stroke(
                            isSelected ? Color.blue.opacity(0.32) : Color.secondary.opacity(0.16),
                            lineWidth: 1
                        )
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(
            accessibilityIsShown ? String(localized: "Shown") : String(localized: "Hidden")
        )
    }

    private var foreground: Color {
        if isDown { return ScooterPalette.secondaryText }
        return isSelected ? ScooterPalette.actionText : .primary
    }

    private var background: Color {
        if isDown { return .clear }
        return isSelected ? Color.blue.opacity(0.13) : Color.primary.opacity(0.055)
    }

    @ViewBuilder
    private var indicator: some View {
        if let color {
            Circle()
                .fill(isDown ? Color.secondary : color)
                .frame(width: 11, height: 11)
                .overlay {
                    Circle().stroke(.background, lineWidth: 1.5)
                }
                .accessibilityHidden(true)
        } else {
            Image(systemName: "circle.grid.2x2.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(isSelected ? ScooterPalette.actionText : Color.secondary)
        }
    }

    private var accessibilityLabel: String {
        if isDown { return accessibilityTitle }
        if count == 1 {
            return String(format: String(localized: "%@, one scooter"), accessibilityTitle)
        }
        return String(
            format: String(localized: "%@, %lld scooters"),
            accessibilityTitle,
            Int64(count)
        )
    }
}

private struct ScooterCard: View {
    let model: ScooterMapModel
    let scooter: Scooter
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardStatusLine(model: model)
            header
            pills

            DockActionRow {
                Button {
                    ScooterAnalytics.shared.track("directions_open", provider: scooter.provider, target: "vehicle")
                    openWalkingDirections(to: scooter)
                } label: {
                    Label("Directions", systemImage: "figure.walk")
                        .frame(maxWidth: .infinity)
                }
                .dockActionStyle(prominent: false)

                if let rentalURL = scooter.rentalURL {
                    Button {
                        ScooterAnalytics.shared.track("rental_open", provider: scooter.provider)
                        UIApplication.shared.open(rentalURL)
                    } label: {
                        Label(
                            String(format: String(localized: "Open in %@"), providerName),
                            systemImage: "scooter"
                        )
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                    }
                    .dockActionStyle(prominent: true)
                }
            }

            Text(String(
                format: scooter.rentalURL == nil
                    ? String(localized: "Open the %@ app to rent this scooter.")
                    : String(localized: "Opens the %@ app. It won’t reserve the scooter."),
                providerName
            ))
            .font(.caption2)
            .foregroundStyle(ScooterPalette.secondaryText)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            if let walk = model.walkingSummary(for: scooter) {
                Button {
                    model.focusOnScooter(scooter)
                } label: {
                    HStack(spacing: 12) {
                        tile
                        titleBlock {
                            Text(walk)
                                .foregroundStyle(ScooterPalette.secondaryText)
                                .monospacedDigit()
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint(String(localized: "Centers this scooter on the map"))
            } else {
                Button {
                    model.focusOnScooter(scooter)
                } label: {
                    tile
                }
                .buttonStyle(.plain)
                .accessibilityLabel(providerName)
                .accessibilityHint(String(localized: "Centers this scooter on the map"))

                if model.isLocating {
                    titleBlock {
                        HStack(spacing: 6) {
                            ProgressView()
                                .controlSize(.mini)
                                .accessibilityHidden(true)
                            Text("Finding your location…")
                        }
                        .foregroundStyle(ScooterPalette.secondaryText)
                    }
                    .accessibilityElement(children: .combine)
                } else {
                    // Locates without moving the map, so this card stays open.
                    Button(action: model.locateForWalkingTime) {
                        titleBlock {
                            Text("Turn on location to see walking time")
                                .foregroundStyle(ScooterPalette.actionText)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer(minLength: 4)

            DockCloseButton(accessibilityLabel: String(localized: "Close scooter details")) {
                model.selectScooter(nil)
            }
        }
    }

    private var tile: some View {
        DockSymbolTile(systemImage: "scooter", tint: providerTint, size: 48)
    }

    private func titleBlock(@ViewBuilder subtitle: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(providerName)
                .font(.headline)
            subtitle()
                .font(.footnote)
        }
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .frame(minHeight: 44, alignment: .leading)
    }

    private var pills: some View {
        FlowLayout(spacing: 6, lineSpacing: 0) {
            if let battery = scooter.battery, let level = scooter.batteryLevel {
                HStack(spacing: 5) {
                    Image(systemName: batterySymbol(for: battery))
                    Text("\(battery)%")
                }
                .dockPill(level.color, background: level.color.opacity(0.14))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(String(localized: "Battery"))
                .accessibilityValue(String(format: String(localized: "%lld percent"), Int64(battery)))
            }

            if let range = scooter.formattedRange {
                HStack(spacing: 5) {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                    Text(range)
                }
                .dockPill()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(String(localized: "Estimated"))
                .accessibilityValue(range)
            }

            pricePill
        }
        // The price pill's 44 pt target makes the row taller than the pills look.
        .padding(.vertical, -4)
    }

    @ViewBuilder
    private var pricePill: some View {
        if let quote = model.ridePriceQuote(for: scooter) {
            let price = priceLabel(quote)
            Menu {
                ForEach(RideEstimateDuration.allowedMinutes, id: \.self) { minutes in
                    Button {
                        model.setRideEstimateMinutes(minutes)
                    } label: {
                        if minutes == model.rideEstimateMinutes {
                            Label(durationLabel(minutes), systemImage: "checkmark")
                        } else {
                            Text(durationLabel(minutes))
                        }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    if quote.passApplied {
                        Image(systemName: "ticket.fill")
                    }
                    Text(price)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.bold))
                        .opacity(0.6)
                }
                .dockPill(
                    quote.passApplied ? ScooterPalette.good : .primary,
                    background: quote.passApplied
                        ? ScooterPalette.good.opacity(0.14)
                        : Color(uiColor: .tertiarySystemFill)
                )
                // The pill stays small; its target is 44 pt high.
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(
                format: String(localized: "Ride estimate, %lld minutes. Change duration."),
                Int64(model.rideEstimateMinutes)
            ))
            .accessibilityValue(price)
        } else {
            HStack(spacing: 5) {
                Image(systemName: "creditcard")
                    .accessibilityHidden(true)
                Text(String(format: String(localized: "Price shown in the %@ app"), providerName))
            }
            .dockPill()
            .frame(minHeight: 44)
        }
    }

    /// "≈ CHF 4.50 for 10 min", followed by "Pass applied" when a pass lowers it.
    private func priceLabel(_ quote: RidePriceQuote) -> String {
        let estimate = String(
            format: String(localized: "≈ %1$@ for %2$lld min"),
            RidePriceFormatter.string(minorUnits: quote.totalMinorUnits, currency: quote.currency),
            Int64(quote.durationMinutes)
        )
        guard quote.passApplied else { return estimate }
        return String(
            format: String(localized: "%1$@ · %2$@"),
            estimate,
            String(localized: "Pass applied")
        )
    }

    private func durationLabel(_ minutes: Int) -> String {
        String(format: String(localized: "%lld min"), Int64(minutes))
    }

    private var providerName: String {
        scooter.providerInfo?.name ?? scooter.provider.capitalized
    }

    private var providerTint: Color {
        providerAccent(scooter.providerInfo, colorScheme: colorScheme)
    }
}

private struct ParkingBayCard: View {
    let model: ScooterMapModel
    let parking: ScooterParking
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardStatusLine(model: model)

            HStack(spacing: 12) {
                HStack(spacing: 12) {
                    Text(verbatim: "P")
                        .font(.system(size: 23, weight: .heavy, design: .rounded))
                        .frame(width: 48, height: 48)
                        .background(
                            Color(uiColor: .systemBackground),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(
                                    providerAccent(parking.providerInfo, colorScheme: colorScheme),
                                    lineWidth: 3
                                )
                        }
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(parking.bayTitle)
                            .font(.headline)
                        let subtitle = model.parkingSubtitle(for: parking)
                        if !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.footnote)
                                .foregroundStyle(ScooterPalette.secondaryText)
                                .monospacedDigit()
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)

                Spacer(minLength: 4)

                DockCloseButton(accessibilityLabel: String(localized: "Close parking details")) {
                    model.selectParking(nil)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "info.circle")
                    .accessibilityHidden(true)
                Text(parking.notice)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(parking.mandatory ? ScooterPalette.warning : Color.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                parking.mandatory
                    ? ScooterPalette.warning.opacity(0.14)
                    : Color(uiColor: .tertiarySystemFill),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )

            DockActionRow {
                Button {
                    ScooterAnalytics.shared.track("directions_open", provider: parking.provider, target: "parking")
                    openWalkingDirections(to: parking)
                } label: {
                    Label("Directions", systemImage: "figure.walk")
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                }
                .dockActionStyle(prominent: true)
            }

            Text(parking.footnote)
                .font(.caption2)
                .foregroundStyle(ScooterPalette.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
        }
    }
}

private extension ScooterBatteryLevel {
    var color: Color {
        switch self {
        case .good: ScooterPalette.good
        case .low: ScooterPalette.warning
        case .critical: ScooterPalette.critical
        }
    }
}

/// The provider's colour; Bird's near-black turns to the label colour in dark appearance.
private func providerAccent(_ provider: ScooterProvider?, colorScheme: ColorScheme) -> Color {
    guard let provider else { return .blue }
    if provider == .bird, colorScheme == .dark {
        return Color(uiColor: .label)
    }
    return provider.color
}

private enum RidePriceFormatter {
    static func string(minorUnits: Int, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = .current
        formatter.numberStyle = .currency
        formatter.currencyCode = currency.uppercased()
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2

        let amount = NSDecimalNumber(value: minorUnits)
            .dividing(by: NSDecimalNumber(value: 100))
        return formatter.string(from: amount)
            ?? "\(currency.uppercased()) \(amount.stringValue)"
    }
}

/// Filters: a minimum battery and the providers to show. Choices apply at
/// once, so the button at the bottom can say what the map will show.
struct ScooterFilterSheet: View {
    @Bindable var model: ScooterMapModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    batteryFilters
                    providerFilters
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 16)
            }
            .background(Self.sheetBackground)
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Reset", action: model.resetFilters)
                        .disabled(!model.hasActiveFilters)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                showResultsButton
            }
            .sensoryFeedback(.selection, trigger: model.enabledProviders)
            .sensoryFeedback(.selection, trigger: model.minimumBattery)
        }
    }

    private var batteryFilters: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Battery")

            batteryPresetLayout {
                ForEach(ScooterBatteryFilter.presets, id: \.self) { preset in
                    batteryPreset(preset)
                }
            }
            .padding(4)
            .background(
                Color(uiColor: .tertiarySystemFill),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .accessibilityElement(children: .contain)
            .accessibilityLabel(String(localized: "Battery"))

            if model.minimumBattery > 0 {
                Text("Scooters without battery info are hidden while a minimum is set.")
                    .font(.footnote)
                    .foregroundStyle(ScooterPalette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
        }
    }

    /// Side by side; one above the other when the text is very large.
    private var batteryPresetLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 4))
            : AnyLayout(HStackLayout(spacing: 4))
    }

    private func batteryPreset(_ preset: Int) -> some View {
        let selected = Int(model.minimumBattery) == preset
        return Button {
            model.setMinimumBattery(Double(preset))
        } label: {
            // "30%+" reads the same in every language; only "Any" is translated.
            Text(verbatim: ScooterBatteryFilter.label(for: preset))
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .monospacedDigit()
                .frame(maxWidth: .infinity, minHeight: 44)
                .background {
                    if selected {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Self.selectedPresetFill)
                            .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            preset == 0
                ? String(localized: "Any")
                : String(format: String(localized: "%lld percent or more"), Int64(preset))
        )
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The raised segment of the chosen minimum, as in a segmented control.
    private static let selectedPresetFill = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? .systemGray2 : .white
    })

    private var providerFilters: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Providers")

            VStack(alignment: .leading, spacing: 0) {
                let entries = model.filterProviders
                if entries.isEmpty {
                    // No provider operates in this part of the map.
                    Text("No scooter data here yet")
                        .font(.subheadline)
                        .foregroundStyle(ScooterPalette.secondaryText)
                        .padding(.horizontal, 14)
                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                }
                ForEach(entries) { entry in
                    providerRow(entry)
                    if entry.id != entries.last?.id {
                        Divider()
                            .padding(.leading, 62)
                    }
                }
            }
            .background(
                Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
        }
    }

    private func providerRow(_ entry: ScooterProviderEntry) -> some View {
        Button {
            model.toggle(provider: entry.provider)
        } label: {
            HStack(spacing: 12) {
                // Dark initials on a tint of the provider's colour, never white on the colour itself.
                Text(verbatim: entry.provider.shortName)
                    .font(.footnote.weight(.bold))
                    // The tile keeps its size, so with very large text the initials shrink to fit.
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    .foregroundStyle(entry.isDown ? ScooterPalette.secondaryText : Color.primary)
                    .frame(width: 36, height: 36)
                    .background(
                        entry.isDown
                            ? Color.secondary.opacity(0.14)
                            : providerAccent(entry.provider, colorScheme: colorScheme).opacity(0.2),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.provider.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(entry.isDown ? ScooterPalette.secondaryText : Color.primary)
                    if entry.isDown {
                        Text("Not sharing data right now")
                            .font(.caption)
                            .foregroundStyle(ScooterPalette.warning)
                    }
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 8)

                if !entry.isDown {
                    Text(entry.count, format: .number)
                        .font(.subheadline)
                        .foregroundStyle(ScooterPalette.secondaryText)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }

                providerCheck(entry)
                    .frame(width: 26, height: 26)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(providerAccessibilityLabel(entry))
        .accessibilityValue(entry.isEnabled ? String(localized: "Shown") : String(localized: "Hidden"))
    }

    /// A check for a provider that is shown, an empty circle for one that is
    /// hidden, and a dashed circle for one that is chosen but shares no data.
    @ViewBuilder
    private func providerCheck(_ entry: ScooterProviderEntry) -> some View {
        if !entry.isEnabled {
            Image(systemName: "circle")
                .font(.system(size: 22))
                .foregroundStyle(ScooterPalette.secondaryText)
        } else if entry.isDown {
            Circle()
                .strokeBorder(ScooterPalette.secondaryText, style: StrokeStyle(lineWidth: 1.5, dash: [3.5, 3]))
                .padding(2)
        } else {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(ScooterPalette.actionFill)
        }
    }

    private var showResultsButton: some View {
        Button {
            dismiss()
        } label: {
            Text(showResultsTitle)
                .frame(maxWidth: .infinity)
                .foregroundStyle(.white)
        }
        .dockActionStyle(prominent: true)
        .font(.headline)
        .controlSize(.large)
        // The button stays over the list, so its text stops growing before it covers it.
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        // The list ends above the button instead of showing through and under it.
        .background {
            Self.sheetBackground
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            LinearGradient(
                colors: [Self.sheetBackground.opacity(0), Self.sheetBackground],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 14)
            .offset(y: -14)
            .allowsHitTesting(false)
        }
    }

    private static let sheetBackground = Color(uiColor: .systemGroupedBackground)

    /// What the map will show with the current choices. While the answer for
    /// a new minimum is still on its way there is no count to promise.
    private var showResultsTitle: String {
        if case .finding = model.dock {
            return String(localized: "Finding scooters…")
        }
        return model.showResultsTitle
    }

    private func sectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(ScooterPalette.secondaryText)
            .padding(.horizontal, 4)
            .accessibilityAddTraits(.isHeader)
    }

    private func providerAccessibilityLabel(_ entry: ScooterProviderEntry) -> String {
        if entry.isDown { return entry.downLabel }
        if entry.count == 1 {
            return String(format: String(localized: "%@, one scooter"), entry.provider.name)
        }
        return String(
            format: String(localized: "%@, %lld scooters"),
            entry.provider.name,
            Int64(entry.count)
        )
    }
}

/// Settings: how the map looks, the rider's passes, and About with the
/// credits, the privacy choice and the source code.
struct ScooterSettingsSheet: View {
    @Bindable var model: ScooterMapModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationStack {
            Form {
                Section("Map") {
                    Picker("Appearance", selection: $model.mapStyle) {
                        ForEach(AppleMapStyle.allCases) { style in
                            Text(style.label).tag(style)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    // Only the providers that matter here: those operating on
                    // this part of the map, and those the rider has a pass for.
                    ForEach(model.passProviders) { provider in
                        NavigationLink {
                            ProviderRidePassEditor(model: model, provider: provider)
                        } label: {
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(providerAccent(provider, colorScheme: colorScheme))
                                    .frame(width: 10, height: 10)
                                Text(provider.name)
                                Spacer(minLength: 8)
                                Text(passStatus(for: provider))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.trailing)
                                    .lineLimit(2)
                            }
                        }
                    }
                } header: {
                    Text("Passes")
                } footer: {
                    Text("Pass benefits are used only for estimates. Free-minute balances are not reduced automatically.")
                }

                Section {
                    NavigationLink {
                        ScooterCreditsList()
                    } label: {
                        Label("Map & data credits", systemImage: "map")
                    }

                    NavigationLink {
                        ScooterPrivacySettings()
                    } label: {
                        Label("Privacy", systemImage: "hand.raised")
                    }

                    Link(destination: ScooterLinks.sourceCode) {
                        ExternalLinkRow(
                            title: String(localized: "Source code on GitHub"),
                            systemImage: "chevron.left.forwardslash.chevron.right"
                        )
                    }
                } header: {
                    Text("About")
                } footer: {
                    Text("Availability refreshes automatically. Opening a provider app doesn’t reserve a scooter.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func passStatus(for provider: ScooterProvider) -> String {
        let pass = model.ridePass(for: provider)
        guard pass.enabled else { return String(localized: "Not set") }
        guard pass.isActive(on: .now) else { return String(localized: "Expired") }

        var benefits: [String] = []
        if pass.freeUnlock {
            benefits.append(String(localized: "Free unlock"))
        }
        if pass.freeMinutes > 0 {
            benefits.append(String(
                format: String(localized: "%lld free min"),
                Int64(pass.freeMinutes)
            ))
        }
        return benefits.isEmpty
            ? String(localized: "Pass active")
            : benefits.joined(separator: " · ")
    }
}

enum ScooterLinks {
    static let privacyNotice = URL(string: "https://scooters.plhery.com/privacy")!
    static let sourceCode = URL(string: "https://github.com/plhery/swiss-scooters")!
}

/// Settings › About › Privacy: the one choice about usage data, and the notice.
struct ScooterPrivacySettings: View {
    @AppStorage(ScooterAnalytics.disabledKey) private var analyticsDisabled = false

    var body: some View {
        Form {
            Section {
                Toggle("Share anonymous usage", isOn: Binding(
                    get: { !analyticsDisabled },
                    set: { analyticsDisabled = !$0 }
                ))
            } footer: {
                Text("Helps improve Scooters. No addresses or precise locations are sent.")
            }

            Section {
                Link(destination: ScooterLinks.privacyNotice) {
                    ExternalLinkRow(title: String(localized: "Read the privacy notice"))
                }
            }
        }
        .navigationTitle("Privacy")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Settings › About › Map & data credits: where the map and the data come from.
struct ScooterCreditsList: View {
    struct Source: Identifiable {
        let title: String
        let url: URL

        var id: URL { url }
    }

    /// The same sources as the credits list on the web. Names of feeds and
    /// operators are not translated.
    static var sources: [Source] {
        [
            Source(
                title: String(localized: "Mobility data sources"),
                url: URL(string: "https://opentransportdata.swiss/en/cookbook/shared-mobility/")!
            ),
            Source(
                title: String(localized: "French mobility data"),
                url: URL(string: "https://transport.data.gouv.fr/datasets?type=vehicles-sharing")!
            ),
            Source(
                title: "MobiData BW",
                url: URL(string: "https://www.mobidata-bw.de/")!
            ),
            Source(
                title: "DE/IT: Dott, Bolt, Hopp, Lime, Voi, Bird",
                url: URL(string: "https://github.com/MobilityData/gbfs")!
            ),
            Source(
                title: String(localized: "Address data © swisstopo"),
                url: URL(string: "https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api")!
            ),
            Source(
                title: String(
                    format: String(localized: "%1$@ · %2$@"),
                    String(localized: "Parking"),
                    "Métropole Européenne de Lille"
                ),
                url: URL(string: "https://data.lillemetropole.fr/")!
            )
        ]
    }

    var body: some View {
        Form {
            Section {
                // Apple shows its own map credits on the map, behind "Legal".
                LabeledContent {
                    Text(verbatim: "Apple Maps")
                } label: {
                    Text("Map")
                }
            }

            Section {
                ForEach(Self.sources) { source in
                    Link(destination: source.url) {
                        ExternalLinkRow(title: source.title)
                    }
                }
            }
        }
        .navigationTitle("Map & data credits")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A row that leaves the app: its text, and an arrow that says so.
private struct ExternalLinkRow: View {
    let title: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 8) {
            if let systemImage {
                Label {
                    Text(title)
                        .foregroundStyle(Color.primary)
                } icon: {
                    Image(systemName: systemImage)
                }
            } else {
                Text(title)
                    .foregroundStyle(Color.primary)
            }

            Spacer(minLength: 8)

            Image(systemName: "arrow.up.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color(uiColor: .tertiaryLabel))
                .accessibilityHidden(true)
        }
        .multilineTextAlignment(.leading)
    }
}

private struct ProviderRidePassEditor: View {
    @Bindable var model: ScooterMapModel
    let provider: ScooterProvider

    var body: some View {
        Form {
            Section {
                Toggle("I have a pass", isOn: passBinding(\.enabled))
            } footer: {
                Text("Your pass details stay on this iPhone.")
            }

            if pass.enabled {
                Section("Pass benefits") {
                    Toggle("Free unlock", isOn: passBinding(\.freeUnlock))

                    Stepper(
                        value: passBinding(\.freeMinutes),
                        in: 0 ... 500,
                        step: 5
                    ) {
                        HStack {
                            Text("Free minutes available")
                            Spacer()
                            Text(pass.freeMinutes, format: .number)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                }

                Section {
                    Toggle("Has expiry date", isOn: hasExpiryBinding)

                    if pass.expiryDate != nil {
                        DatePicker(
                            "Valid through",
                            selection: expiryDateBinding,
                            displayedComponents: .date
                        )

                        if !pass.isActive(on: .now) {
                            Label("This pass has expired", systemImage: "exclamationmark.circle.fill")
                                .font(.subheadline)
                                .foregroundStyle(ScooterPalette.warning)
                        }
                    }
                } header: {
                    Text("Expiry")
                } footer: {
                    Text("Benefits remain active through the end of the selected day.")
                }
            }

            Section {
                Text("Pricing can vary. Confirm the final price and pass eligibility in the provider app before riding.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(String(format: String(localized: "%@ pass"), provider.name))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var pass: ProviderRidePass {
        model.ridePass(for: provider)
    }

    private func passBinding<Value>(
        _ keyPath: WritableKeyPath<ProviderRidePass, Value>
    ) -> Binding<Value> {
        Binding {
            model.ridePass(for: provider)[keyPath: keyPath]
        } set: { value in
            var updatedPass = model.ridePass(for: provider)
            updatedPass[keyPath: keyPath] = value
            model.setRidePass(updatedPass, for: provider)
        }
    }

    private var hasExpiryBinding: Binding<Bool> {
        Binding {
            model.ridePass(for: provider).expiryDate != nil
        } set: { hasExpiry in
            var updatedPass = model.ridePass(for: provider)
            updatedPass.expiryDate = hasExpiry ? defaultExpiryDate : nil
            model.setRidePass(updatedPass, for: provider)
        }
    }

    private var expiryDateBinding: Binding<Date> {
        Binding {
            model.ridePass(for: provider).expiryDate ?? defaultExpiryDate
        } set: { expiryDate in
            var updatedPass = model.ridePass(for: provider)
            updatedPass.expiryDate = expiryDate
            model.setRidePass(updatedPass, for: provider)
        }
    }

    private var defaultExpiryDate: Date {
        Calendar.current.date(byAdding: .month, value: 1, to: .now) ?? .now
    }
}

/// The locate button above the dock. Until this device has located once it
/// is a labelled blue pill; after that the round icon button is enough.
struct FloatingMapControls: View {
    let model: ScooterMapModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if model.hasLocatedOnce {
                Button(action: model.focusOnUser) {
                    indicator
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 50, height: 50)
                }
                .buttonStyle(.glass)
                .accessibilityLabel(String(localized: "Go to my location"))
            } else {
                Button(action: model.focusOnUser) {
                    HStack(spacing: 8) {
                        indicator
                        Text("Near me")
                    }
                    .font(.body.weight(.semibold))
                    // While locating the button is disabled and the system greys the pill:
                    // white would be lost on that grey.
                    .foregroundStyle(model.isLocating ? Color.primary : Color.white)
                    .padding(.horizontal, 4)
                    .frame(minHeight: 40)
                }
                .buttonStyle(.glassProminent)
                .tint(ScooterPalette.actionFill)
                .shadow(color: ScooterPalette.actionFill.opacity(0.28), radius: 7, y: 6)
            }
        }
        .disabled(model.isLocating)
        .accessibilityValue(model.isLocating ? String(localized: "Finding your location…") : "")
        .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: model.hasLocatedOnce)
    }

    private var indicator: some View {
        ZStack {
            Image(systemName: "location.fill")
                .opacity(model.isLocating ? 0 : 1)
            if model.isLocating {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .accessibilityHidden(true)
    }
}

private struct LiveIndicator: View {
    @State private var isPulsing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .stroke(.green.opacity(reduceMotion ? 0.18 : (isPulsing ? 0 : 0.32)), lineWidth: 2)
                .scaleEffect(reduceMotion ? 1.35 : (isPulsing ? 1.75 : 0.8))
            Circle()
                .fill(.green)
        }
        .frame(width: 7, height: 7)
        .accessibilityHidden(true)
        .task {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) {
                isPulsing = true
            }
        }
    }
}

/// The banner under the search bar while nothing has loaded and the load
/// failed: the reason and a filled Try again button.
struct MapStatusBanner: View {
    let message: String
    let actionTitle: String
    var isBusy = false
    let action: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 9) {
                        statusIndicator
                        statusMessage
                    }

                    statusAction
                        .frame(maxWidth: .infinity)
                }
            } else {
                HStack(spacing: 9) {
                    statusIndicator
                    statusMessage
                    Spacer(minLength: 0)
                    statusAction
                }
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, dynamicTypeSize.isAccessibilitySize ? 14 : 5)
        .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? 10 : 2)
        // As wide as the search bar above it, whatever the length of the sentence.
        .frame(maxWidth: 560)
        .background {
            TopChromeTapShield(cornerRadius: bannerCornerRadius)
        }
        .chromeGlass(in: RoundedRectangle(cornerRadius: bannerCornerRadius, style: .continuous))
        .shadow(color: .black.opacity(0.07), radius: 9, y: 4)
        .task(id: message) {
            guard UIAccessibility.isVoiceOverRunning else { return }
            UIAccessibility.post(notification: .announcement, argument: message)
        }
    }

    private var bannerCornerRadius: CGFloat {
        dynamicTypeSize.isAccessibilitySize ? 22 : 999
    }

    private var statusIndicator: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .foregroundStyle(ScooterPalette.critical)
            .accessibilityHidden(true)
    }

    private var statusMessage: some View {
        Text(message)
            .font(.caption.weight(.semibold))
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 5 : 3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var statusAction: some View {
        Button(action: action) {
            ZStack {
                Text(actionTitle)
                    .opacity(isBusy ? 0 : 1)
                if isBusy {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                }
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(minHeight: 34)
            .background(ScooterPalette.criticalFill, in: Capsule())
            // The pill stays small; its target is 44 pt high.
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .accessibilityLabel(actionTitle)
    }
}

/// The dismissible card under the search bar when locating did not work:
/// what happened and the ways forward.
struct LocationIssueCard: View {
    let issue: ScooterLocationIssue
    let onOpenSettings: () -> Void
    let onSearchPlace: () -> Void
    let onRetry: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DockSymbolTile(
                systemImage: "location.slash",
                foreground: ScooterPalette.warning,
                tint: ScooterPalette.warning,
                size: 40
            )
            .padding(.top, 2)

            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                    if let title = issue.title {
                        Text(title)
                            .font(.subheadline.weight(.semibold))
                        Text(issue.message)
                            .font(.footnote)
                            .foregroundStyle(ScooterPalette.secondaryText)
                    } else {
                        Text(issue.message)
                            .font(.subheadline.weight(.medium))
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44, alignment: .leading)
                .accessibilityElement(children: .combine)

                FlowLayout(spacing: 20, lineSpacing: 0) {
                    if issue.canOpenSettings {
                        action("Open Settings", perform: onOpenSettings)
                    }
                    if issue.canSearchPlace {
                        action("Search a place", perform: onSearchPlace)
                    }
                    if issue.canRetry {
                        action("Try again", perform: onRetry)
                    }
                }
            }

            Spacer(minLength: 0)

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(ScooterPalette.secondaryText)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(localized: "Dismiss"))
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .frame(maxWidth: 560)
        .background {
            TopChromeTapShield(cornerRadius: 24)
        }
        .chromeGlass(in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
        .task(id: issue) {
            guard UIAccessibility.isVoiceOverRunning else { return }
            UIAccessibility.post(
                notification: .announcement,
                argument: [issue.title, issue.message].compactMap { $0 }.joined(separator: " ")
            )
        }
    }

    private func action(_ title: LocalizedStringKey, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ScooterPalette.actionText)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Taps on the empty parts of a banner or card stay there instead of
/// reaching the map underneath.
private struct TopChromeTapShield: View {
    let cornerRadius: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color.clear)
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .onTapGesture { }
            .accessibilityHidden(true)
    }
}

private func openWalkingDirections(to scooter: Scooter) {
    let location = CLLocation(latitude: scooter.latitude, longitude: scooter.longitude)
    let destination = MKMapItem(location: location, address: nil)
    let providerName = scooter.providerInfo?.name ?? scooter.provider.capitalized
    destination.name = String(
        format: String(localized: "%@ scooter"),
        providerName
    )
    destination.openInMaps(launchOptions: [
        MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
    ])
}

private func openWalkingDirections(to parking: ScooterParking) {
    let location = CLLocation(latitude: parking.latitude, longitude: parking.longitude)
    let destination = MKMapItem(location: location, address: nil)
    destination.name = parking.name.isEmpty ? parking.bayTitle : parking.name
    destination.openInMaps(launchOptions: [
        MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
    ])
}

private func batterySymbol(for battery: Int) -> String {
    switch battery {
    case 75 ... 100: "battery.100percent"
    case 50 ..< 75: "battery.75percent"
    case 25 ..< 50: "battery.50percent"
    case 10 ..< 25: "battery.25percent"
    default: "battery.0percent"
    }
}

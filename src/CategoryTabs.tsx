import { categories, type CategoryId } from "./domain";

export function CategoryTabs({
  value,
  onChange,
}: {
  value: CategoryId;
  onChange: (categoryId: CategoryId) => void;
}) {
  return (
    <nav className="category-tabs" aria-label="比賽項目">
      {categories.map((category, index) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onChange(category.id)}
          className={value === category.id ? "selected" : ""}
          aria-pressed={value === category.id}
          aria-label={`${category.eventName}（${category.name}）`}
        >
          <span className="category-index">0{index + 1}</span>
          <span className="category-label">
            {category.eventName}
            <small>（{category.name}）</small>
          </span>
        </button>
      ))}
    </nav>
  );
}

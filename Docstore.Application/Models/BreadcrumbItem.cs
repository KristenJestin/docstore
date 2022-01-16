namespace Docstore.Application.Models
{
    public class BreadcrumbItem
    {
        public string Title { get; set; }
        public string? Action { get; set; }
        public string? Controller { get; set; }
        public Dictionary<string, string> Routes { get; set; }
        public string? Icon { get; set; }

        public BreadcrumbItem(string title, string? action = null, string? controller = null, Dictionary<string, string>? routes = null, string? icon = null)
        {
            Title = title;
            Action = action;
            Controller = controller;
            Routes = routes ?? new Dictionary<string, string>();
            Icon = icon;
        }


        #region methods
        public bool IsLink()
            => !string.IsNullOrWhiteSpace(Action);
        #endregion
    }
}

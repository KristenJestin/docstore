using Docstore.App.Common.Extensions;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.TagHelpers;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Razor.TagHelpers;
using System.Text.Encodings.Web;

namespace Docstore.App.TagHelpers
{
    [HtmlTargetElement(Attributes = "asp-errors-class")]
    public class ClassOnValidationTagHelper : TagHelper
    {
        public ModelExpression? AspFor { get; set; }
        public ModelExpression? AspValidationFor { get; set; }
        public string? AspErrorsClass { get; set; }
        public string? AspValidClass { get; set; }

        [ViewContext, HtmlAttributeNotBound]
        public ViewContext? ViewContext { get; set; }

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            if ((AspValidationFor == null && AspFor == null) || ViewContext == null)
                return;

            var prefix = ViewContext.ViewData.TemplateInfo.HtmlFieldPrefix;
            var name = (AspValidationFor ?? AspFor).Name;

            if (ViewContext.ViewData.ModelState.HasError(GetPropertyName(name, prefix)) && AspErrorsClass != null)
                foreach (var item in AspErrorsClass.Split(" "))
                    output.AddClass(item, HtmlEncoder.Default);
            else if (AspValidClass != null)
                foreach (var item in AspValidClass.Split(" "))
                    output.AddClass(item, HtmlEncoder.Default);
        }


        #region privates
        private string GetPropertyName(string name, string prefix)
        {
            if (!string.IsNullOrWhiteSpace(prefix))
                prefix = $"{prefix}.";

            return prefix + name;
        }
        #endregion
    }
}

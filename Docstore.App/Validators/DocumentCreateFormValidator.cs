using Docstore.App.Models.Forms;
using FluentValidation;

namespace Docstore.App.Validators
{
    public class DocumentCreateFormValidator : AbstractValidator<DocumentCreateForm>
	{
		public DocumentCreateFormValidator()
		{
			RuleFor(x => x.Name)
				.NotEmpty()
				.MaximumLength(255);

			RuleFor(x => x.Files)
				.Must(x => x == null || x.Any()).WithMessage("You must pick at least one file!");
		}
	}
}
